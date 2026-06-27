/**
 * Global footer carrying the mandatory compliance text so it appears on every
 * page by construction (DESIGN §10, NFR-10, FR-44/AC-7):
 *  - Supercell Fan Content "not affiliated" disclaimer
 *  - ClashKing data attribution
 *  - cwlranking.vercel.app ranking credit
 */
export function Footer() {
  return (
    <footer>
      <p>
        Clasher is not affiliated with, endorsed, sponsored, or specifically approved by Supercell.
        See{" "}
        <a
          href="https://supercell.com/en/fan-content-policy/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Supercell&apos;s Fan Content Policy
        </a>
        .
      </p>
      <p>
        Historical war &amp; Clan War League data via{" "}
        <a href="https://clashk.ing" target="_blank" rel="noopener noreferrer">
          ClashKing
        </a>
        . CWL ranking inspired by{" "}
        <a href="https://cwlranking.vercel.app" target="_blank" rel="noopener noreferrer">
          cwlranking.vercel.app
        </a>
        .
      </p>
    </footer>
  );
}
