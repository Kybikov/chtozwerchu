import { useEffect, useState } from "react";
import { Disc3 } from "lucide-react";

export default function AlbumCover({
  src,
  alt = "",
  size = 30,
  loading,
}: {
  src: string;
  alt?: string;
  size?: number;
  loading?: "lazy" | "eager";
}) {
  const [failed, setFailed] = useState<string>();
  useEffect(() => {
    const retry = () => setFailed(undefined);
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []);
  return src && failed !== src ? (
    <img src={src} alt={alt} loading={loading} onError={() => setFailed(src)} />
  ) : (
    <Disc3
      className="album-cover-fallback"
      size={size}
      role={alt ? "img" : undefined}
      aria-hidden={!alt}
      aria-label={alt ? `${alt} недоступна` : undefined}
    />
  );
}
