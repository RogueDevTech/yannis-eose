import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const COMMENT_BUBBLE_SVG = (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
    <path fillRule="evenodd" d="M4.848 2.771A49.144 49.144 0 0112 2.25c2.43 0 4.817.178 7.152.52 1.978.292 3.348 2.024 3.348 3.97v6.02c0 1.946-1.37 3.678-3.348 3.97a48.901 48.901 0 01-3.476.383.39.39 0 00-.297.17l-2.755 4.133a.75.75 0 01-1.248 0l-2.755-4.133a.39.39 0 00-.297-.17 48.9 48.9 0 01-3.476-.384c-1.978-.29-3.348-2.024-3.348-3.97V6.741c0-1.946 1.37-3.68 3.348-3.97zM6.75 8.25a.75.75 0 01.75-.75h9a.75.75 0 010 1.5h-9a.75.75 0 01-.75-.75zm.75 2.25a.75.75 0 000 1.5H12a.75.75 0 000-1.5H7.5z" clipRule="evenodd" />
  </svg>
);

/** Small comment bubble SVG for inline use in mobile cards. */
export const COMMENT_BUBBLE_SVG_SMALL = (
  <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-app-fg-muted" viewBox="0 0 24 24" fill="currentColor">
    <path fillRule="evenodd" d="M4.848 2.771A49.144 49.144 0 0112 2.25c2.43 0 4.817.178 7.152.52 1.978.292 3.348 2.024 3.348 3.97v6.02c0 1.946-1.37 3.678-3.348 3.97a48.901 48.901 0 01-3.476.383.39.39 0 00-.297.17l-2.755 4.133a.75.75 0 01-1.248 0l-2.755-4.133a.39.39 0 00-.297-.17 48.9 48.9 0 01-3.476-.384c-1.978-.29-3.348-2.024-3.348-3.97V6.741c0-1.946 1.37-3.68 3.348-3.97zM6.75 8.25a.75.75 0 01.75-.75h9a.75.75 0 010 1.5h-9a.75.75 0 01-.75-.75zm.75 2.25a.75.75 0 000 1.5H12a.75.75 0 000-1.5H7.5z" clipRule="evenodd" />
  </svg>
);

/**
 * Hoverable/tappable comment bubble icon with a popup showing the comment.
 * Uses a portal so the tooltip escapes overflow-hidden table containers.
 */
export function CsCommentIcon({ comment, actorName }: { comment: string; actorName: string | null }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; flipDown: boolean } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!show) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setShow(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [show]);

  const handleShow = () => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const flipDown = rect.top < 80;
      setPos({
        top: flipDown ? rect.bottom + 8 : rect.top - 8,
        left: rect.right,
        flipDown,
      });
    }
    setShow(true);
  };

  return (
    <span
      ref={ref}
      className="relative inline-flex shrink-0 cursor-pointer rounded-full bg-amber-100 p-1 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
      onMouseEnter={handleShow}
      onMouseLeave={() => setShow(false)}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); show ? setShow(false) : handleShow(); }}
      aria-label="CS comment"
      title="CS comment"
    >
      {COMMENT_BUBBLE_SVG}
      {show && pos && createPortal(
        <span
          className="fixed z-[9999] whitespace-normal rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-lg text-left dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200 pointer-events-none"
          style={{
            top: pos.flipDown ? pos.top : undefined,
            bottom: pos.flipDown ? undefined : `${window.innerHeight - pos.top}px`,
            right: `${window.innerWidth - pos.left}px`,
            minWidth: '12rem',
            maxWidth: '22rem',
          }}
        >
          <span className="block leading-relaxed">{comment}</span>
        </span>,
        document.body,
      )}
    </span>
  );
}

/**
 * Inline comment preview for mobile cards — shows the comment text with a
 * small bubble icon in a muted card row.
 */
export function MobileCommentPreview({ comment }: { comment: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-app-hover/60 px-2.5 py-1.5 text-xs border border-app-border">
      {COMMENT_BUBBLE_SVG_SMALL}
      <span className="min-w-0 flex-1 line-clamp-2 text-app-fg">{comment}</span>
    </div>
  );
}
