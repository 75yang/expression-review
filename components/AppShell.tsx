"use client";

import { usePathname } from "next/navigation";
import { useSyncExternalStore, type ReactNode } from "react";

function subscribe(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

export function useWorkspaceView() {
  return useSyncExternalStore(subscribe, () => {
    const hash = window.location.hash;
    return hash === "#capture" ? "capture" : hash === "#settings" ? "settings" : "library";
  }, () => "library");
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const view = useWorkspaceView();
  const isLibraryRoute = pathname === "/app";
  const selected = isLibraryRoute ? view : "library";
  if (pathname === "/" || pathname === "/demo") return <main id="main-content">{children}</main>;
  return (
    <div className="applicationShell">
      <a className="skipLink" href="#main-content">跳到主要内容</a>
      <aside className="applicationSidebar">
        <a href={isLibraryRoute ? "#library" : "/app#library"} className="applicationBrand">
          <span className="brandMark" aria-hidden="true">言</span>
          <span>表达训练库<small>记录 · 回看 · 改进</small></span>
        </a>
        <nav aria-label="主导航" className="applicationNav">
          <a href={isLibraryRoute ? "#library" : "/app#library"} aria-current={selected === "library" ? "page" : undefined}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/></svg> 素材库
          </a>
          <a href={isLibraryRoute ? "#capture" : "/app#capture"} aria-current={selected === "capture" ? "page" : undefined}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg> 录制与上传
          </a>
          <a className="settingsNavLink" href={isLibraryRoute ? "#settings" : "/app#settings"} aria-current={selected === "settings" ? "page" : undefined}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="currentColor"/><circle cx="15" cy="17" r="3" fill="currentColor"/></svg> 设置
          </a>
        </nav>
        <p className="sidebarCaption">每一次表达，都是一次练习。</p>
      </aside>
      <div className="applicationContent" id="main-content" tabIndex={-1}>{children}</div>
    </div>
  );
}
