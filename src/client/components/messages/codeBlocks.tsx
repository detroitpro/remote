import React, { useState } from 'react';
import type { CodeBlockItem } from '../../../server/types.js';

export function isRenderableCodeBlockItem(item: CodeBlockItem): boolean {
  return !!(item && ((item.code || '').trim() || item.diffLines?.length));
}

export function CodeBlockBody({ item }: { item: CodeBlockItem }) {
  if (item.blockKind === 'diff' && item.diffLines?.length) {
    return (
      <div className="code-block-diff-plain">
        {item.diffLines.map((line, index) => (
          <div key={index} className={`code-block-diff-line code-block-diff-line--${line.kind || 'ctx'}`}>
            {line.text}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="code-block-diff-plain code-block-diff-plain--raw">
      <pre><code>{item.code || ''}</code></pre>
    </div>
  );
}

export function NativeCodeBlock({ item, onFullscreen }: { item: CodeBlockItem; onFullscreen: () => void }) {
  const title = (item.filename || item.language || '').trim();
  return (
    <div className="code-block native-code-block">
      <div className={`code-block-toolbar ${title ? '' : 'code-block-toolbar--actions-only'}`}>
        {title && <div className="code-block-header">{title}</div>}
        <button type="button" className="code-block-fullscreen-btn" aria-label="View full screen" onClick={onFullscreen}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" /></svg>
        </button>
      </div>
      <div className="code-block-viewport">
        <CodeBlockBody item={item} />
      </div>
    </div>
  );
}

export function NativeCodeBlocks({ codeBlocks }: { codeBlocks: CodeBlockItem[] }) {
  const [fullscreenBlock, setFullscreenBlock] = useState<CodeBlockItem | null>(null);
  const renderable = codeBlocks.filter(isRenderableCodeBlockItem);
  return (
    <>
      {renderable.map((block, index) => (
        <NativeCodeBlock key={`${block.filename || block.language || index}:${index}`} item={block} onFullscreen={() => setFullscreenBlock(block)} />
      ))}
      {fullscreenBlock && (
        <div className="code-block-fs-overlay" role="dialog" aria-modal="true" aria-label={fullscreenBlock.filename || 'Code'}>
          <div className="code-block-fs-backdrop" onClick={() => setFullscreenBlock(null)} />
          <div className="code-block-fs-panel">
            <div className="code-block-fs-panel-header">
              <span className="code-block-fs-title">{fullscreenBlock.filename || fullscreenBlock.language || 'Code'}</span>
              <button type="button" className="code-block-fs-close" aria-label="Close" onClick={() => setFullscreenBlock(null)}>x</button>
            </div>
            <div className="code-block-fs-scroll">
              <CodeBlockBody item={fullscreenBlock} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
