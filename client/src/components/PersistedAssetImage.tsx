import { useEffect, useState, type CSSProperties } from "react";

export const PERSISTED_ASSET_ERROR_LABEL = "圖片載入失敗";

export function getPersistedAssetPresentation(src: string | null | undefined, failed = false) {
  const hasSource = Boolean(src?.trim());

  return {
    hasSource,
    shouldRenderImage: hasSource && !failed,
    shouldRenderFallback: hasSource && failed,
    fallbackLabel: PERSISTED_ASSET_ERROR_LABEL,
  };
}

export function PersistedAssetImage(props: {
  src: string | null | undefined;
  alt: string;
  imgClassName: string;
  fallbackClassName: string;
  imgStyle?: CSSProperties;
  fallbackStyle?: CSSProperties;
  onAssetSettle?: () => void;
}) {
  const { src, alt, imgClassName, fallbackClassName, imgStyle, fallbackStyle, onAssetSettle } = props;
  const [failed, setFailed] = useState(false);
  const presentation = getPersistedAssetPresentation(src, failed);

  function notifyAssetSettle() {
    if (!onAssetSettle) {
      return;
    }

    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => onAssetSettle());
      return;
    }

    onAssetSettle();
  }

  useEffect(() => {
    if (failed) {
      notifyAssetSettle();
    }
  }, [failed]);

  if (!presentation.hasSource) {
    return null;
  }

  if (presentation.shouldRenderFallback) {
    return (
      <div role="img" aria-label={alt} className={fallbackClassName} style={fallbackStyle}>
        {presentation.fallbackLabel}
      </div>
    );
  }

  return (
    <img
      src={src ?? undefined}
      alt={alt}
      className={imgClassName}
      style={imgStyle}
      onLoad={notifyAssetSettle}
      onError={() => setFailed(true)}
    />
  );
}
