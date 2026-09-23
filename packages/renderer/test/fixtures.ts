import { createElement, type ElementOfType, type ElementType, type NewElementProps, type SceneElement } from '@inkflow/elements';
import type { ImageSource } from '../src';

let counter = 0;

/** Deterministic element factory for tests (fixed ids and seeds unless overridden). */
export function make<T extends ElementType>(type: T, props: NewElementProps<T> = {}): ElementOfType<T> {
  counter++;
  return createElement(type, {
    id: `${type}-${counter}`,
    seed: 1000 + counter,
    versionNonce: counter,
    ...props,
  } as NewElementProps<T>);
}

export const noImages: ImageSource = {
  get: () => null,
  status: () => 'missing',
};

export function lookup(elements: readonly SceneElement[]): (id: string) => SceneElement | undefined {
  const map = new Map(elements.map((e) => [e.id, e]));
  return (id) => map.get(id);
}
