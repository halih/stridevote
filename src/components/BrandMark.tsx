import Image from "next/image";

/** The app icon: rounded-square housing with the StrideVote walker. */
export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <Image
      className="brand-mark"
      src="/brand/stridevote-icon.svg"
      alt=""
      width={size}
      height={size}
      priority
    />
  );
}
