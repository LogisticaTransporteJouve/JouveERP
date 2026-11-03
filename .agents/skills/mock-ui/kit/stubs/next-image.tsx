// next/image for the mock: a plain <img>; build.mjs inlines /public files as data URLs.
export default function Image({ src, alt, priority, fill, sizes, quality, placeholder, blurDataURL, loader, unoptimized, ...p }: any) {
  return <img src={typeof src === "string" ? src : src?.src} alt={alt ?? ""} {...p} />;
}
