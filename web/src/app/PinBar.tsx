/* ============================================================
   PinBar — **T-26 핀 슬롯**의 표면. 상단 크롬 옆 한 줄.

   ## 왜 전역인가

   고정의 값은 **어느 화면에 있든 보인다**는 것 하나다. 특정 탭 안에 두면 그 탭으로 가야
   보이고, 그러면 "매번 그 화면으로 돌아간다"를 못 없앤다.

   ## ⚠ 아무것도 안 고정했으면 **줄이 없다**

   빈 슬롯을 그려 두면 높이가 늘 흔들리고, "평온엔 아무것도 안 그린다"가 레이아웃에서 배신
   당한다(`RailSidebar` 의 신호줄이 같은 이유로 조건부다).

   ## ⚠ 고정 버튼은 여기 없다

   지금 화면을 고정하는 버튼은 **크롬**이 갖는다(`TopBar`) — 핀 바는 *결과*를 그리는 자리고,
   둘을 한 컴포넌트에 넣으면 아무것도 고정 안 했을 때 바가 사라지면서 **고정 버튼도 함께
   사라진다**(고정할 방법이 없어진다).
============================================================ */
import { useNavigate } from 'react-router-dom';
import { useUI } from '@/store/useUI';

export default function PinBar() {
  const pins = useUI((s) => s.ui.pins);
  const toggle = useUI((s) => s.togglePin);
  const navigate = useNavigate();
  if (!pins.length) return null;

  return (
    <div className="flex flex-none flex-wrap items-center gap-1.5 border-b border-line px-5.5 py-1.5" aria-label="고정">
      {pins.map((p) => (
        <span key={p.to} className="ds-pill ds-tiny flex items-center gap-1">
          <button type="button" className="border-0! bg-transparent! p-0! text-inherit!" onClick={() => navigate(p.to)}>
            {p.label}
          </button>
          <button
            type="button"
            className="border-0! bg-transparent! p-0! text-mut!"
            aria-label={`${p.label} 고정 해제`}
            onClick={() => toggle(p.to, p.label, p.at)}
          >
            ✕
          </button>
        </span>
      ))}
    </div>
  );
}
