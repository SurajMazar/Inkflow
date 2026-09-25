# Deployment

This guide covers production deployment of Inkflow: what the system needs, best practices, and
step-by-step recipes for a single VM, any Kubernetes cluster, **AWS** (EKS or ECS Fargate) and
**Google Cloud** (GKE or Cloud Run).

- [What you are deploying](#what-you-are-deploying)
- [Best practices checklist](#best-practices-checklist)
- [1. Build and publish images](#1-build-and-publish-images)
- [2. Configuration](#2-configuration)
- [3. Database migrations](#3-database-migrations)
- [Option A: single VM with Podman or Docker Compose](#option-a-single-vm-with-podman-or-docker-compose)
- [Option B: any Kubernetes cluster](#option-b-any-kubernetes-cluster)
- [Option C: AWS](#option-c-aws)
- [Option D: Google Cloud](#option-d-google-cloud)
- [Operations](#operations)

## What you are deploying

```text
            ┌──────────── HTTPS load balancer / ingress (TLS, WebSocket support) ────────────┐
Browser ───▶│  /api/*  ─────────────▶  api × N  (NestJS, stateless, port 4000)                │
            │  /*      ─────────────▶  web × N  (nginx serving the SPA, port 8080)            │
            └──────────────────────────────┬──────────────────────────────────────────────────┘
                                           │
             PostgreSQL 15+          Redis 6+              S3-compatible storage       SMTP
             (source of truth)       (pub/sub, presence,   (images, thumbnails)        (verification,
                                      rate limits)                                      resets, invites)
```

| Component      | Image / service                         | Notes                                                                                                                                                           |
| -------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API            | `apps/api/Dockerfile`                   | Stateless; any instance can serve any request or WebSocket (no sticky sessions). Health: `/api/health` (liveness), `/api/health/ready` (PostgreSQL, Redis, S3). |
| Web            | `apps/web/Dockerfile`                   | nginx serving static files; can also proxy `/api` to a host named `api` (used by Compose). On cloud load balancers, route `/api` directly to the API instead.   |
| PostgreSQL     | Managed (RDS, Cloud SQL…)               | All persistent data. Needs the `pg_trgm` extension (created by the first migration).                                                                            |
| Redis          | Managed (ElastiCache, Memorystore…)     | Cross-instance fan-out of edits, presence, rate limits. Small memory footprint.                                                                                 |
| Object storage | S3, Cloud Storage (XML API), MinIO, R2… | Private bucket; files are always served through the API with permission checks.                                                                                 |
| SMTP           | SES, SendGrid, Mailgun…                 | Required for email verification, password resets and invitations.                                                                                               |

Load balancer requirements: TLS termination, **WebSocket upgrades on `/api/ws`**, an idle timeout
of at least 60 s (3600 s recommended; clients heartbeat every 15 s), and a request body limit of at
least 25 MB for image uploads.

## Best practices checklist

**Security**

- Terminate TLS at the load balancer, redirect HTTP to HTTPS, enable HSTS, and set
  `COOKIE_SECURE=true` and `TRUST_PROXY=true`.
- Generate unique `JWT_SECRET` and `SESSION_SECRET` values per environment
  (`openssl rand -base64 48`), and store them in a secrets manager (AWS Secrets Manager, GCP Secret
  Manager) synced into the platform. Never bake them into images. The API refuses to start with
  placeholder secrets in production.
- Grant storage access through workload identity (IRSA on EKS, ECS task roles, Workload Identity
  on GKE) instead of static keys where the provider supports it. Leave `S3_ACCESS_KEY` and
  `S3_SECRET_KEY` unset to use the AWS default credential chain.
- Keep PostgreSQL, Redis and the bucket off the public internet (private subnets or private IPs),
  and require TLS for PostgreSQL (`sslmode=require`) and Redis (`rediss://`).
- Run containers as non-root with a read-only mindset (the manifests drop all capabilities), and
  scan images in CI.
- Keep the built-in rate limits (or stricter), and configure SPF/DKIM/DMARC for `MAIL_FROM`.

**Reliability**

- Run at least 2 API and 2 web replicas across availability zones, with pod disruption budgets.
- Run migrations as a separate release step (a Kubernetes Job, an ECS one-off task or a Cloud Run
  job) with `SKIP_MIGRATIONS=true` on the API, so rolling restarts never race on schema changes.
- Use `/api/health/ready` for readiness and `/api/health` for liveness. Add a 10 s pre-stop delay
  so load balancers stop routing before pods shut down; the API drains WebSockets on SIGTERM.
- Scale down slowly: each removed API instance disconnects its WebSocket clients (they reconnect
  automatically and resync from `lastSeq`, so no work is lost).

**Data**

- Enable point-in-time recovery and automated backups for PostgreSQL; test restores.
- Enable versioning (or soft delete) on the storage bucket.
- Apply migrations forward-only and back up before each release.

**Observability**

- Ship the API's structured JSON logs (pino, with request ids; secrets are redacted) to CloudWatch,
  Cloud Logging or your log stack.
- Alert on readiness failures, 5xx rate, PostgreSQL CPU/connections, Redis memory and WebSocket
  disconnect spikes.

**Performance and cost**

- Put a CDN in front of the web service: hashed assets are immutable, `index.html` is not cached.
- Size PostgreSQL for writes: every edit is a short transaction on `board_elements` and
  `board_operations`. The operation log is compacted automatically.
- Start small (2 × 0.25 vCPU / 512 MB API, the smallest managed Redis) and let the HPA scale on CPU.

## 1. Build and publish images

The included GitHub Actions workflow (`.github/workflows/ci.yml`) runs lint, typecheck, unit,
integration and end-to-end tests, then pushes `inkflow-api` and `inkflow-web` to GHCR, tagged with
the commit SHA and `latest`. Deploy immutable SHA tags, not `latest`.

To build and push manually (Podman or Docker):

```bash
podman build -f apps/api/Dockerfile -t REGISTRY/inkflow-api:1.0.0 .
```

```bash
podman build -f apps/web/Dockerfile -t REGISTRY/inkflow-web:1.0.0 .
```

```bash
podman push REGISTRY/inkflow-api:1.0.0 && podman push REGISTRY/inkflow-web:1.0.0
```

Build for the architecture your nodes run (`--platform linux/amd64` when building on Apple Silicon
for x86 clusters).

## 2. Configuration

All settings are environment variables validated at startup (`packages/config/src/env.ts`); see
[`.env.example`](.env.example) for the full list.

| Variable                                                        | Production value                                                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `NODE_ENV`                                                      | `production`                                                                                     |
| `WEB_ORIGIN`                                                    | `https://inkflow.example.com` (CORS, email links, WebSocket origin check)                        |
| `PUBLIC_API_URL`                                                | `https://inkflow.example.com/api` (OAuth callbacks)                                              |
| `DATABASE_URL`                                                  | `postgresql://USER:PASS@HOST:5432/inkflow?sslmode=require`                                       |
| `REDIS_URL`                                                     | `rediss://:PASS@HOST:6379`                                                                       |
| `JWT_SECRET`, `SESSION_SECRET`                                  | 48+ random bytes each, from a secrets manager                                                    |
| `COOKIE_SECURE`, `TRUST_PROXY`                                  | `true`                                                                                           |
| `S3_BUCKET`, `S3_REGION`                                        | Your bucket and region                                                                           |
| `S3_ENDPOINT`                                                   | Unset for AWS S3; `https://storage.googleapis.com` for Cloud Storage; your endpoint for MinIO/R2 |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY`                                | Unset to use workload identity on AWS; HMAC keys for Cloud Storage                               |
| `S3_FORCE_PATH_STYLE`                                           | `false` for AWS S3, `true` for Cloud Storage and MinIO                                           |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Your SMTP provider                                                                               |
| `GOOGLE_*`, `GITHUB_*`                                          | Optional OAuth; callbacks are `${PUBLIC_API_URL}/auth/oauth/{google,github}/callback`            |
| `SKIP_MIGRATIONS`                                               | `true` on the API when migrations run as a separate step                                         |

## 3. Database migrations

Migrations are committed SQL files in `packages/database/prisma/migrations`, applied with
`prisma migrate deploy` (forward-only; never generates migrations in production).

The API image's entrypoint accepts a `migrate` argument that applies migrations and exits.

- **Simple setups:** the API container applies pending migrations on start (the default). Prisma
  takes an advisory lock, so concurrent starts are safe.
- **Recommended for clusters:** run migrations once per release before rolling out the API, and
  set `SKIP_MIGRATIONS=true` on the API:

  ```bash
  docker run --rm -e DATABASE_URL="$DATABASE_URL" REGISTRY/inkflow-api:1.0.0 migrate
  ```

  The Kubernetes manifests include this as the `inkflow-migrate` Job.

## Option A: single VM with Podman or Docker Compose

Good for small teams, internal tools and staging. One VM (2 vCPU, 4 GB RAM) runs everything.

1. Install Podman (or Docker) and clone the repository.
2. Point a DNS record (e.g. `inkflow.example.com`) at the VM.
3. Create a file with strong secrets and your public URL:

   ```bash
   printf 'INKFLOW_JWT_SECRET=%s\nINKFLOW_SESSION_SECRET=%s\n' "$(openssl rand -base64 48)" "$(openssl rand -base64 48)" > .env.stack
   ```

   Edit `docker-compose.yml` so the `api` service's `WEB_ORIGIN` and `PUBLIC_API_URL` use your
   domain, and set real SMTP settings.

4. Start the stack:

   ```bash
   podman compose --env-file .env.stack --profile app up -d --build
   ```

5. Put a TLS reverse proxy in front of the web container (port 8190). With Caddy, a two-line
   `Caddyfile` provisions certificates automatically and supports WebSockets:

   ```text
   inkflow.example.com {
     reverse_proxy localhost:8190
   }
   ```

6. Back up the `postgres-data` and `minio-data` volumes (or use a managed database and bucket
   instead of the bundled containers for real production use).

## Option B: any Kubernetes cluster

Manifests live in [`deploy/kubernetes`](deploy/kubernetes) as a Kustomize base plus cloud
overlays:

```text
deploy/kubernetes/
  base/             namespace, config, migration Job, API (Deployment, Service, HPA, PDB),
                    web (Deployment, Service, PDB), ingress-nginx Ingress
  overlays/eks/     AWS Load Balancer Controller ingress, ACM certificate, IRSA, ECR images
  overlays/gke/     GCE ingress, managed certificate, BackendConfig, Workload Identity, Artifact Registry
```

The base assumes [ingress-nginx](https://kubernetes.github.io/ingress-nginx/) and
[cert-manager](https://cert-manager.io/) (for the `inkflow-tls` certificate), and managed
PostgreSQL, Redis and object storage reachable from the cluster.

1. Edit `base/configmap.yaml` (domain, bucket, region, mail sender) and the host in
   `base/ingress.yaml`, and set the image names/tags in `base/kustomization.yaml`.
2. Create the namespace and the secrets (see `base/secret.example.yaml` for every key):

   ```bash
   kubectl apply -f deploy/kubernetes/base/namespace.yaml
   ```

   ```bash
   kubectl -n inkflow create secret generic inkflow-secrets \
     --from-literal=DATABASE_URL='postgresql://inkflow:PASS@DB_HOST:5432/inkflow?sslmode=require' \
     --from-literal=REDIS_URL='rediss://:PASS@REDIS_HOST:6379' \
     --from-literal=JWT_SECRET="$(openssl rand -base64 48)" \
     --from-literal=SESSION_SECRET="$(openssl rand -base64 48)" \
     --from-literal=S3_ACCESS_KEY='KEY' --from-literal=S3_SECRET_KEY='SECRET' \
     --from-literal=SMTP_HOST='smtp.example.com' --from-literal=SMTP_USER='USER' --from-literal=SMTP_PASS='PASS'
   ```

   In production, prefer the [External Secrets Operator](https://external-secrets.io/) syncing from
   your cloud secrets manager.

3. Deploy (the migration Job runs alongside; the API waits for readiness):

   ```bash
   kubectl apply -k deploy/kubernetes/base
   ```

   ```bash
   kubectl -n inkflow wait --for=condition=complete job/inkflow-migrate --timeout=300s
   ```

   ```bash
   kubectl -n inkflow rollout status deploy/api && kubectl -n inkflow rollout status deploy/web
   ```

4. For each release, update the image tags, delete the finished migration Job, and re-apply:

   ```bash
   kubectl -n inkflow delete job inkflow-migrate --ignore-not-found && kubectl apply -k deploy/kubernetes/base
   ```

Preview the rendered manifests with `kubectl kustomize deploy/kubernetes/overlays/gke` (or `eks`).

## Option C: AWS

### C1. Amazon EKS (Kubernetes)

Services: **EKS** (compute), **RDS for PostgreSQL** (Multi-AZ), **ElastiCache for Redis** (TLS),
**S3** (files), **ECR** (images), **ACM** (certificate), **ALB** via the AWS Load Balancer
Controller, **SES** (SMTP), **Secrets Manager**.

1. **Cluster.** Create a cluster with managed nodes across three AZs and enable OIDC for IRSA:

   ```bash
   eksctl create cluster --name inkflow --region us-east-1 --nodes 3 --node-type t3.medium --with-oidc
   ```

   Install the [AWS Load Balancer Controller](https://kubernetes-sigs.github.io/aws-load-balancer-controller/)
   and the [Metrics Server](https://github.com/kubernetes-sigs/metrics-server) (for the HPA).

2. **Data services** in the cluster's VPC (private subnets):
   - RDS PostgreSQL 16/17, Multi-AZ, automated backups and PITR, security group allowing the
     node security group on 5432.
   - ElastiCache for Redis with in-transit encryption and an auth token (`rediss://` URL).
   - An S3 bucket with Block Public Access, default encryption and versioning.
   - SES SMTP credentials with a verified domain.
3. **Storage access through IRSA.** Create an IAM role for the `inkflow-api` service account with
   `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` and `s3:ListBucket` on the bucket:

   ```bash
   eksctl create iamserviceaccount --cluster inkflow --namespace inkflow --name inkflow-api \
     --attach-policy-arn arn:aws:iam::ACCOUNT_ID:policy/inkflow-files --role-only --role-name inkflow-api --approve
   ```

   Leave `S3_ACCESS_KEY` and `S3_SECRET_KEY` out of the Secret so the SDK uses the role.

4. **Images.** Push both images to ECR (or let CI push them).
5. **Configure** `deploy/kubernetes/overlays/eks`: account id, ECR image names and tags, the ACM
   certificate ARN, the IAM role ARN, and bucket/region in `config.yaml`. Set your domain in
   `base/configmap.yaml` and `base/ingress.yaml`.
6. **Secrets.** Create `inkflow-secrets` (step 2 of Option B) or sync it from Secrets Manager with
   the External Secrets Operator.
7. **Deploy:**

   ```bash
   kubectl apply -k deploy/kubernetes/overlays/eks
   ```

8. **DNS.** Point your domain (Route 53 alias) at the ALB created for the `inkflow` ingress
   (`kubectl -n inkflow get ingress inkflow`).

### C2. Amazon ECS on Fargate (no Kubernetes)

Simpler to operate when you don't need Kubernetes.

1. Create the same data services as in C1 (RDS, ElastiCache, S3, SES) and push images to ECR.
2. Store secrets in Secrets Manager and reference them from the task definitions (`secrets` with
   `valueFrom`), so they are injected as environment variables.
3. Create two task definitions:
   - **api**: port 4000, `SKIP_MIGRATIONS=true`, the environment from [Configuration](#2-configuration),
     a task role with the S3 policy (no static keys), 0.5 vCPU / 1 GB, container health check
     `/api/health`, stop timeout 45 s.
   - **web**: port 8080, 0.25 vCPU / 512 MB.
4. Create an ALB with an HTTPS listener (ACM certificate), idle timeout 3600 s, and two target
   groups (type `ip`): `api` (health check `/api/health/ready`) and `web` (health check `/`). Add
   a listener rule `/api/*` → `api`, with the default action → `web`.
5. Create two ECS services (at least 2 tasks each, spread across AZs, in private subnets) attached
   to the target groups, with service auto scaling on CPU for the API.
6. For each release, run migrations as a one-off task before updating the API service:

   ```bash
   aws ecs run-task --cluster inkflow --launch-type FARGATE --task-definition inkflow-api \
     --network-configuration 'awsvpcConfiguration={subnets=[subnet-aaa,subnet-bbb],securityGroups=[sg-api]}' \
     --overrides '{"containerOverrides":[{"name":"api","command":["migrate"]}]}'
   ```

## Option D: Google Cloud

### D1. Google Kubernetes Engine

Services: **GKE** (Autopilot or Standard), **Cloud SQL for PostgreSQL** (private IP, HA),
**Memorystore for Redis**, **Cloud Storage** (through its S3-compatible XML API), **Artifact
Registry**, **Google-managed certificates**, **Secret Manager**.

1. **Project and network.** Enable the APIs and create an Autopilot cluster:

   ```bash
   gcloud services enable container.googleapis.com sqladmin.googleapis.com redis.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
   ```

   ```bash
   gcloud container clusters create-auto inkflow --region us-central1
   ```

2. **Data services** on the cluster's VPC:
   - Cloud SQL for PostgreSQL 16/17 with a private IP, high availability, automated backups and
     PITR; create the `inkflow` database and user.
   - Memorystore for Redis (Standard tier) with in-transit encryption and AUTH.
   - A Cloud Storage bucket with uniform bucket-level access and public access prevention, plus
     **HMAC keys** for a service account with `roles/storage.objectAdmin` on the bucket (Inkflow
     talks to Cloud Storage through the S3-compatible XML API).
3. **Static IP and DNS.** Reserve a global address and point your domain at it:

   ```bash
   gcloud compute addresses create inkflow-ip --global
   ```

4. **Images.** Push both images to Artifact Registry:

   ```bash
   gcloud artifacts repositories create inkflow --repository-format=docker --location=us
   ```

5. **Configure** `deploy/kubernetes/overlays/gke`: project id and image names, your domain in
   `gke-extras.yaml` (managed certificate), the Workload Identity service account, and the bucket
   in `config.yaml`. Set your domain in `base/configmap.yaml` and `base/ingress.yaml`.
6. **Secrets.** Create `inkflow-secrets` with `DATABASE_URL` (Cloud SQL private IP), `REDIS_URL`,
   the JWT/session secrets, `S3_ENDPOINT=https://storage.googleapis.com`, `S3_ACCESS_KEY` /
   `S3_SECRET_KEY` (the HMAC key id and secret) and SMTP settings, or sync them from Secret Manager
   with the External Secrets Operator.
7. **Deploy:**

   ```bash
   kubectl apply -k deploy/kubernetes/overlays/gke
   ```

   The managed certificate becomes active once DNS resolves to the static IP (this can take up to
   an hour). The `BackendConfig` raises the load balancer timeout to 3600 s so collaboration
   WebSockets stay open.

### D2. Cloud Run (serverless)

Cloud Run supports WebSockets (connections live up to the request timeout, 60 minutes maximum;
clients reconnect and resync automatically).

1. Create Cloud SQL, Memorystore and the bucket as in D1, plus a
   [Serverless VPC Access connector](https://cloud.google.com/vpc/docs/serverless-vpc-access) (or
   Direct VPC egress) so Cloud Run can reach Memorystore and Cloud SQL's private IP.
2. Store secrets in Secret Manager.
3. Deploy the API:

   ```bash
   gcloud run deploy inkflow-api --image us-docker.pkg.dev/PROJECT/inkflow/inkflow-api:1.0.0 \
     --region us-central1 --port 4000 --timeout 3600 --min-instances 1 --cpu 1 --memory 1Gi \
     --vpc-connector inkflow-connector --no-cpu-throttling \
     --set-env-vars NODE_ENV=production,SKIP_MIGRATIONS=true,TRUST_PROXY=true,COOKIE_SECURE=true,WEB_ORIGIN=https://inkflow.example.com,PUBLIC_API_URL=https://inkflow.example.com/api,S3_ENDPOINT=https://storage.googleapis.com,S3_REGION=auto,S3_FORCE_PATH_STYLE=true,S3_BUCKET=inkflow-prod-files \
     --set-secrets DATABASE_URL=inkflow-database-url:latest,REDIS_URL=inkflow-redis-url:latest,JWT_SECRET=inkflow-jwt:latest,SESSION_SECRET=inkflow-session:latest,S3_ACCESS_KEY=inkflow-hmac-id:latest,S3_SECRET_KEY=inkflow-hmac-secret:latest
   ```

   Keep `--min-instances` at 1 or more so collaboration sessions don't cold start, and use
   `--no-cpu-throttling` so WebSocket heartbeats and background jobs keep running.

4. Deploy the web service:

   ```bash
   gcloud run deploy inkflow-web --image us-docker.pkg.dev/PROJECT/inkflow/inkflow-web:1.0.0 --region us-central1 --port 8080
   ```

5. Put both behind one global external Application Load Balancer with serverless NEGs, a
   Google-managed certificate for your domain, and a URL map that sends `/api/*` to `inkflow-api`
   and everything else to `inkflow-web`. Set the backend service timeout for the API to 3600 s.
6. Run migrations per release as a Cloud Run job using the API image:

   ```bash
   gcloud run jobs deploy inkflow-migrate --image us-docker.pkg.dev/PROJECT/inkflow/inkflow-api:1.0.0 --region us-central1 \
     --vpc-connector inkflow-connector --set-secrets DATABASE_URL=inkflow-database-url:latest \
     --args migrate --execute-now --wait
   ```

### Other platforms

Any platform that runs containers and offers a TLS load balancer with WebSocket support works the
same way (Azure Container Apps or AKS, DigitalOcean App Platform, Fly.io, Render). Provide managed
PostgreSQL and Redis, an S3-compatible bucket (Azure Blob Storage needs an S3-compatible gateway;
Cloudflare R2, DigitalOcean Spaces and Backblaze B2 work directly), route `/api` to the API, and
set the variables from [Configuration](#2-configuration).

## Operations

- **Verify a deployment:** `curl https://inkflow.example.com/api/health/ready` should report
  PostgreSQL, Redis and storage as `ok`. Sign in, open a board in two browsers, and check that
  edits sync.
- **Logs:** structured JSON with request ids; secrets, cookies and passwords are redacted.
- **Graceful shutdown:** on SIGTERM the API stops accepting connections, closes WebSockets with
  "going away" (clients reconnect to another instance), and drains PostgreSQL and Redis.
- **Background jobs:** trash purge and operation-log compaction run on one instance at a time
  (PostgreSQL advisory locks), so no separate worker is needed.
- **Scaling:** scale API replicas horizontally; PostgreSQL row locks serialize edits per board and
  Redis fans them out, so replicas need no coordination. The hot tables are `board_elements`
  (primary key `(board_id, element_id)`) and `board_operations` (unique `(board_id, seq)`).
- **Upgrades and rollback:** run migrations first, then roll out new images. Migrations are
  additive by convention, so rolling the API back to the previous image is safe; restoring data
  requires a database point-in-time restore.
- **Rotating secrets:** changing `JWT_SECRET` signs everyone out; changing `SESSION_SECRET`
  invalidates copyable share-link tokens (existing links keep working through their stored hash).
