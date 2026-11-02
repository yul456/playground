import { useEffect, useState } from "react";

// 휴대폰에서는 공유 창(카카오톡 등)을 열고, 컴퓨터에서는 클립보드에 복사한다
export default function ShareButton({ getText, disabled }) {
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(() => setMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [message]);

  async function share() {
    const text = getText();
    if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
      try {
        await navigator.share({ text });
        return;
      } catch (err) {
        // 공유 창을 닫았으면 그대로 두고, 공유를 못 하면 복사로 넘어간다
        if (err.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setMessage("복사했습니다. 단톡방에 붙여 넣으세요.");
    } catch {
      setMessage("복사하지 못했습니다.");
    }
  }

  return (
    <div className="share">
      <span className="share-message" role="status">{message}</span>
      <button type="button" className="secondary" onClick={share} disabled={disabled}>📤 날씨 공유</button>
    </div>
  );
}
