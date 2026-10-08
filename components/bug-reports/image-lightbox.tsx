import { Modal } from "@/components/ui/modal";

/**
 * 评论附件放大看，照旧页面的 #img-modal：半透明黑底上直接放图（不套白框），图 8px 圆角带阴影。
 * Bug Reports 图右上方有白色 ✕；Task Board 旧页面没有 ✕（点背景关），传 closeButton={false}。
 */
export function ImageLightbox({
  url,
  alt = "Attachment",
  closeButton = true,
  onClose,
}: {
  url: string;
  alt?: string;
  closeButton?: boolean;
  onClose: () => void;
}) {
  const titleId = "image-lightbox-title";
  return (
    <Modal
      titleId={titleId}
      onDismiss={onClose}
      panelClassName="relative !w-auto max-w-[90vw] !rounded-none !bg-transparent p-0 !shadow-none"
    >
      <h2 id={titleId} className="sr-only">
        {alt}
      </h2>
      {closeButton ? (
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute -top-8 right-0 cursor-pointer border-0 bg-transparent text-[22px] text-white"
        >
          ✕
        </button>
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element -- ClickUp 附件，外部地址 */}
      <img
        src={url}
        alt={alt}
        className="block max-h-[90vh] max-w-[90vw] rounded-[8px] shadow-[0_20px_60px_rgba(0,0,0,0.4)]"
      />
    </Modal>
  );
}
