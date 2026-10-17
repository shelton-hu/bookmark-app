/** Decorative brand mark; the surrounding label supplies its accessible name. */
export default function BrandMark({ size = 43, transparent = false }: { size?: number; transparent?: boolean }) {
  const source = transparent ? "/brand/sealed-book-transparent.svg?v=1" : "/brand/sealed-book.svg?v=2";
  return <img className="brand-logo" src={source} width={size} height={size} alt="" aria-hidden="true" draggable={false} />;
}
