/** "Skip to content" link, visible on keyboard focus. Targets the `#main-content` landmark. */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      onClick={(event) => {
        const main = document.getElementById('main-content');
        if (main) {
          event.preventDefault();
          if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
          main.focus();
        }
      }}
      className="fixed top-2 left-2 z-[100] -translate-y-16 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow transition-transform focus:translate-y-0 focus-visible:outline-none"
    >
      Skip to content
    </a>
  );
}
