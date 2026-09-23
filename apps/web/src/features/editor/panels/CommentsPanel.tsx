import type { CommentDto, CommentReplyDto } from '@inkflow/shared';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Spinner,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
  UserAvatar,
  cn,
} from '@inkflow/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Ellipsis, MessageSquare, MessageSquarePlus, RotateCcw } from 'lucide-react';
import * as React from 'react';
import { api } from '@/lib/api';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/features/auth';
import { notify, toastApiError } from '@/features/notifications/notify';
import { useBoardSession, useEditorState } from '../hooks/editor-context';
import { useEditorUi, type CommentDraft } from '../hooks/ui-store';
import { MentionTextarea } from './comments/MentionTextarea';
import {
  decodeMentions,
  encodeMentions,
  parseCommentBody,
  type MentionRef,
} from './comments/mentions';
import { anchorFromDraft, revealComment, useBoardComments } from './comments/use-comments';
import { elementDisplayName } from './element-labels';

type Filter = 'open' | 'resolved';

function useInvalidateComments() {
  const { boardId } = useBoardSession();
  const qc = useQueryClient();
  return React.useCallback(
    () => qc.invalidateQueries({ queryKey: queryKeys.boards.comments(boardId) }),
    [qc, boardId],
  );
}

/** Renders a comment body with mention tokens as chips. */
export function CommentBody({
  body,
  currentUserId,
}: {
  body: string;
  currentUserId: string | null;
}) {
  const segments = React.useMemo(() => parseCommentBody(body), [body]);
  return (
    <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">
      {segments.map((s, i) =>
        s.type === 'text' ? (
          <React.Fragment key={i}>{s.text}</React.Fragment>
        ) : (
          <span
            key={i}
            data-testid="mention-chip"
            className={cn(
              'rounded px-1 py-px font-medium',
              s.id === currentUserId
                ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100'
                : 'bg-primary/10 text-primary',
            )}
          >
            @{s.name}
          </span>
        ),
      )}
    </p>
  );
}

/** Text + mentions state of a comment editor. */
function useDraftText(initial = '') {
  const decoded = React.useMemo(() => decodeMentions(initial), [initial]);
  const [text, setText] = React.useState(decoded.text);
  const [mentions, setMentions] = React.useState<MentionRef[]>(decoded.mentions);
  const reset = () => {
    setText('');
    setMentions([]);
  };
  const encoded = () => encodeMentions(text.trim(), mentions);
  return { text, setText, mentions, setMentions, reset, encoded };
}

function NewCommentComposer({ draft }: { draft: CommentDraft }) {
  const { editor, boardId, shareToken } = useBoardSession();
  const startComment = useEditorUi((s) => s.startComment);
  const setActive = useEditorUi((s) => s.setActiveComment);
  const invalidate = useInvalidateComments();
  const d = useDraftText();
  useEditorState((s) => s.sceneVersion);
  const target = draft.elementId ? editor.getElement(draft.elementId) : undefined;

  const create = useMutation({
    mutationFn: () => {
      const { body, mentions } = d.encoded();
      return api.comments.create(
        boardId,
        { body, mentions, anchor: anchorFromDraft(editor, draft) },
        { shareToken },
      );
    },
    onSuccess: (comment) => {
      d.reset();
      setActive(comment.id);
      void invalidate();
    },
    onError: (error) => toastApiError(error, 'Could not post the comment'),
  });

  const submit = () => {
    if (!d.text.trim() || create.isPending) return;
    create.mutate();
  };

  return (
    <div className="space-y-2 border-b p-3" data-testid="comment-composer">
      <div className="text-xs text-muted-foreground">
        New comment{' '}
        {target ? (
          <>
            on <span className="font-medium text-foreground">{elementDisplayName(target)}</span>
          </>
        ) : (
          'on the canvas'
        )}
      </div>
      <MentionTextarea
        value={d.text}
        onChange={d.setText}
        mentions={d.mentions}
        onMentionsChange={d.setMentions}
        onSubmit={submit}
        onCancel={() => startComment(null)}
        placeholder="Add a comment… Use @ to mention"
        ariaLabel="New comment"
        testId="comment-input"
        autoFocus
        disabled={create.isPending}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => startComment(null)}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={submit}
          disabled={!d.text.trim() || create.isPending}
          data-testid="comment-submit"
        >
          {create.isPending && <Spinner className="size-3.5" />}
          Comment
        </Button>
      </div>
    </div>
  );
}

function EditBody({
  initial,
  onSave,
  onCancel,
  pending,
}: {
  initial: string;
  onSave(body: string, mentions: string[]): void;
  onCancel(): void;
  pending: boolean;
}) {
  const d = useDraftText(initial);
  const save = () => {
    if (!d.text.trim()) return;
    const { body, mentions } = d.encoded();
    onSave(body, mentions);
  };
  return (
    <div className="space-y-2">
      <MentionTextarea
        value={d.text}
        onChange={d.setText}
        mentions={d.mentions}
        onMentionsChange={d.setMentions}
        onSubmit={save}
        onCancel={onCancel}
        ariaLabel="Edit comment"
        testId="comment-edit-input"
        autoFocus
        disabled={pending}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={save} disabled={!d.text.trim() || pending}>
          Save
        </Button>
      </div>
    </div>
  );
}

interface ConfirmState {
  title: string;
  description: string;
  run(): void;
}

function MessageHeader({
  author,
  createdAt,
  updatedAt,
  menu,
}: {
  author: CommentDto['author'];
  createdAt: string;
  updatedAt: string;
  menu?: React.ReactNode;
}) {
  const edited = Date.parse(updatedAt) - Date.parse(createdAt) > 1000;
  return (
    <div className="flex items-center gap-2">
      <UserAvatar
        name={author.name || author.email}
        src={author.avatarUrl}
        className="size-6 text-[10px]"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium">{author.name || author.email}</div>
        <div className="text-[11px] text-muted-foreground" title={formatDateTime(createdAt)}>
          {formatRelativeTime(createdAt)}
          {edited && ' · edited'}
        </div>
      </div>
      {menu}
    </div>
  );
}

function OwnMenu({ label, onEdit, onDelete }: { label: string; onEdit(): void; onDelete(): void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Ellipsis className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-inkflow-ui onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
        <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive">
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ReplyItem({
  reply,
  currentUserId,
  canComment,
  onConfirm,
}: {
  reply: CommentReplyDto;
  currentUserId: string | null;
  canComment: boolean;
  onConfirm(state: ConfirmState): void;
}) {
  const { shareToken } = useBoardSession();
  const invalidate = useInvalidateComments();
  const [editing, setEditing] = React.useState(false);
  const own = canComment && reply.author.id === currentUserId;
  const update = useMutation({
    mutationFn: (vars: { body: string; mentions: string[] }) =>
      api.comments.updateReply(reply.id, vars, { shareToken }),
    onSuccess: () => {
      setEditing(false);
      void invalidate();
    },
    onError: (error) => toastApiError(error, 'Could not update the reply'),
  });
  const remove = useMutation({
    mutationFn: () => api.comments.removeReply(reply.id, { shareToken }),
    onSuccess: () => void invalidate(),
    onError: (error) => toastApiError(error, 'Could not delete the reply'),
  });
  return (
    <li className="space-y-1.5" data-testid="comment-reply">
      <MessageHeader
        author={reply.author}
        createdAt={reply.createdAt}
        updatedAt={reply.updatedAt}
        menu={
          own && !editing ? (
            <OwnMenu
              label="Reply actions"
              onEdit={() => setEditing(true)}
              onDelete={() =>
                onConfirm({
                  title: 'Delete reply?',
                  description: 'This reply will be removed for everyone.',
                  run: () => remove.mutate(),
                })
              }
            />
          ) : null
        }
      />
      {editing ? (
        <EditBody
          initial={reply.body}
          pending={update.isPending}
          onCancel={() => setEditing(false)}
          onSave={(body, mentions) => update.mutate({ body, mentions })}
        />
      ) : (
        <CommentBody body={reply.body} currentUserId={currentUserId} />
      )}
    </li>
  );
}

function CommentThread({
  comment,
  active,
  currentUserId,
  canComment,
  onConfirm,
}: {
  comment: CommentDto;
  active: boolean;
  currentUserId: string | null;
  canComment: boolean;
  onConfirm(state: ConfirmState): void;
}) {
  const { editor, shareToken } = useBoardSession();
  const setActive = useEditorUi((s) => s.setActiveComment);
  const invalidate = useInvalidateComments();
  const [editing, setEditing] = React.useState(false);
  const reply = useDraftText();
  const ref = React.useRef<HTMLLIElement>(null);
  useEditorState((s) => s.sceneVersion);
  const own = canComment && comment.author.id === currentUserId;
  const resolved = !!comment.resolvedAt;
  const anchorEl =
    comment.anchor.type === 'point' ? null : editor.getElement(comment.anchor.elementId);

  React.useEffect(() => {
    if (active) ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [active]);

  const onError = (msg: string) => (error: unknown) => toastApiError(error, msg);
  const toggleResolved = useMutation({
    mutationFn: () =>
      resolved
        ? api.comments.reopen(comment.id, { shareToken })
        : api.comments.resolve(comment.id, { shareToken }),
    onSuccess: () => {
      notify.success(resolved ? 'Thread reopened' : 'Thread resolved');
      void invalidate();
    },
    onError: onError(resolved ? 'Could not reopen the thread' : 'Could not resolve the thread'),
  });
  const update = useMutation({
    mutationFn: (vars: { body: string; mentions: string[] }) =>
      api.comments.update(comment.id, vars, { shareToken }),
    onSuccess: () => {
      setEditing(false);
      void invalidate();
    },
    onError: onError('Could not update the comment'),
  });
  const remove = useMutation({
    mutationFn: () => api.comments.remove(comment.id, { shareToken }),
    onSuccess: () => {
      setActive(null);
      void invalidate();
    },
    onError: onError('Could not delete the comment'),
  });
  const sendReply = useMutation({
    mutationFn: () => {
      const { body, mentions } = reply.encoded();
      return api.comments.reply(comment.id, { body, mentions }, { shareToken });
    },
    onSuccess: () => {
      reply.reset();
      void invalidate();
    },
    onError: onError('Could not post the reply'),
  });

  const activate = () => {
    setActive(comment.id);
    revealComment(editor, comment);
  };

  return (
    <li
      ref={ref}
      data-testid="comment-thread"
      data-comment-id={comment.id}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'border-b px-3 py-3 transition-colors',
        active ? 'bg-accent/60' : 'hover:bg-accent/30',
        resolved && !active && 'opacity-75',
      )}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={`Comment by ${comment.author.name || comment.author.email}`}
        aria-expanded={active}
        onClick={activate}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
            e.preventDefault();
            activate();
          }
        }}
        className="cursor-pointer space-y-1.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MessageHeader
          author={comment.author}
          createdAt={comment.createdAt}
          updatedAt={comment.updatedAt}
          menu={
            <div className="flex items-center">
              {canComment && (
                <button
                  type="button"
                  data-testid="comment-resolve"
                  aria-label={resolved ? 'Reopen thread' : 'Resolve thread'}
                  title={resolved ? 'Reopen' : 'Resolve'}
                  disabled={toggleResolved.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleResolved.mutate();
                  }}
                  className={cn(
                    'inline-flex size-7 items-center justify-center rounded-md outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                    resolved ? 'text-emerald-600' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {resolved ? <RotateCcw className="size-4" /> : <Check className="size-4" />}
                </button>
              )}
              {own && !editing && (
                <OwnMenu
                  label="Comment actions"
                  onEdit={() => {
                    setActive(comment.id);
                    setEditing(true);
                  }}
                  onDelete={() =>
                    onConfirm({
                      title: 'Delete comment?',
                      description:
                        'The comment and all of its replies will be removed for everyone.',
                      run: () => remove.mutate(),
                    })
                  }
                />
              )}
            </div>
          }
        />
        {comment.anchor.type !== 'point' && (
          <div className="truncate text-[11px] text-muted-foreground">
            {anchorEl ? <>On {elementDisplayName(anchorEl)}</> : 'The element was deleted'}
          </div>
        )}
        {editing ? (
          <div onClick={(e) => e.stopPropagation()}>
            <EditBody
              initial={comment.body}
              pending={update.isPending}
              onCancel={() => setEditing(false)}
              onSave={(body, mentions) => update.mutate({ body, mentions })}
            />
          </div>
        ) : (
          <CommentBody body={comment.body} currentUserId={currentUserId} />
        )}
        {resolved && (
          <div className="text-[11px] text-emerald-700 dark:text-emerald-400">
            Resolved{comment.resolvedBy ? ` by ${comment.resolvedBy.name}` : ''}{' '}
            {formatRelativeTime(comment.resolvedAt)}
          </div>
        )}
        {!active && comment.replies.length > 0 && (
          <div className="text-xs text-primary">
            {comment.replies.length} {comment.replies.length === 1 ? 'reply' : 'replies'}
          </div>
        )}
      </div>

      {active && (
        <div className="mt-3 space-y-3 border-l-2 pl-3">
          {comment.replies.length > 0 && (
            <ul className="space-y-3">
              {comment.replies.map((r) => (
                <ReplyItem
                  key={r.id}
                  reply={r}
                  currentUserId={currentUserId}
                  canComment={canComment}
                  onConfirm={onConfirm}
                />
              ))}
            </ul>
          )}
          {canComment && (
            <div className="space-y-2">
              <MentionTextarea
                value={reply.text}
                onChange={reply.setText}
                mentions={reply.mentions}
                onMentionsChange={reply.setMentions}
                onSubmit={() => reply.text.trim() && !sendReply.isPending && sendReply.mutate()}
                placeholder="Reply…"
                ariaLabel="Reply"
                testId="comment-reply-input"
                rows={1}
                disabled={sendReply.isPending}
              />
              {reply.text.trim() && (
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => sendReply.mutate()}
                    disabled={sendReply.isPending}
                    data-testid="comment-reply-submit"
                  >
                    Reply
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** Comment threads of the board: filter, composer for new comments, replies, resolve, mentions. */
export function CommentsPanel() {
  const { editor, canComment } = useBoardSession();
  const { user } = useAuth();
  const draft = useEditorUi((s) => s.commentDraft);
  const activeId = useEditorUi((s) => s.activeCommentId);
  const showResolved = useEditorUi((s) => s.showResolvedComments);
  const setShowResolved = useEditorUi((s) => s.setShowResolved);
  const [filter, setFilter] = React.useState<Filter>('open');
  const [confirm, setConfirm] = React.useState<ConfirmState | null>(null);
  const query = useBoardComments();
  const currentUserId = user?.id ?? null;
  const allowed = canComment && !!user;

  const comments = React.useMemo(() => query.data ?? [], [query.data]);
  const openCount = comments.filter((c) => !c.resolvedAt).length;
  const resolvedCount = comments.length - openCount;

  // A thread activated from a canvas pin may be resolved: switch the filter so it is visible.
  const syncedFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!activeId || syncedFor.current === activeId) return;
    const active = comments.find((c) => c.id === activeId);
    if (!active) return;
    syncedFor.current = activeId;
    setFilter(active.resolvedAt ? 'resolved' : 'open');
  }, [activeId, comments]);

  const visible = React.useMemo(
    () =>
      comments
        .filter((c) => (filter === 'open' ? !c.resolvedAt : !!c.resolvedAt))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [comments, filter],
  );

  return (
    <div data-testid="panel-comments" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <ToggleGroup
          type="single"
          size="sm"
          value={filter}
          onValueChange={(v) => v && setFilter(v as Filter)}
          aria-label="Filter comments"
        >
          <ToggleGroupItem
            value="open"
            className="px-2.5 text-xs"
            data-testid="comments-filter-open"
          >
            Open{openCount ? ` · ${openCount}` : ''}
          </ToggleGroupItem>
          <ToggleGroupItem
            value="resolved"
            className="px-2.5 text-xs"
            data-testid="comments-filter-resolved"
          >
            Resolved{resolvedCount ? ` · ${resolvedCount}` : ''}
          </ToggleGroupItem>
        </ToggleGroup>
        {allowed && !draft && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => editor.setTool('comment')}
            title="Click on the canvas to place a comment (M)"
            data-testid="comment-add"
          >
            <MessageSquarePlus /> Add
          </Button>
        )}
      </div>
      <label className="flex items-center justify-between gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
        Show resolved on canvas
        <Switch
          checked={showResolved}
          onCheckedChange={setShowResolved}
          aria-label="Show resolved comments on canvas"
        />
      </label>

      {!allowed && (
        <div className="border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground" role="note">
          {user ? 'You can read comments on this board.' : 'Sign in to add comments and replies.'}
        </div>
      )}

      {draft && allowed && (
        <NewCommentComposer
          key={`${draft.world.x}:${draft.world.y}:${draft.elementId ?? ''}`}
          draft={draft}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {query.isPending ? (
          <div className="flex justify-center py-10" role="status">
            <Spinner />
            <span className="sr-only">Loading comments…</span>
          </div>
        ) : query.isError ? (
          <div className="space-y-2 p-4 text-center text-sm">
            <p className="text-muted-foreground">Comments could not be loaded.</p>
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            size="sm"
            className="m-3"
            icon={<MessageSquare />}
            title={filter === 'open' ? 'No open comments' : 'No resolved comments'}
            description={
              filter === 'open' && allowed
                ? 'Press M or use the comment tool, then click on the canvas.'
                : undefined
            }
          />
        ) : (
          <ul aria-label={filter === 'open' ? 'Open comments' : 'Resolved comments'}>
            {visible.map((c) => (
              <CommentThread
                key={c.id}
                comment={c}
                active={c.id === activeId}
                currentUserId={currentUserId}
                canComment={allowed}
                onConfirm={setConfirm}
              />
            ))}
          </ul>
        )}
      </div>

      <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent data-inkflow-ui>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                confirm?.run();
                setConfirm(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
