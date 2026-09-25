/**
 * Printable documents. No sidebar and no theme: a document is paper, so this
 * subtree always renders on the light ladder (the .paper scope in
 * globals.css), whatever the viewer has chosen for the app.
 */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <div className="paper min-h-screen">{children}</div>;
}
