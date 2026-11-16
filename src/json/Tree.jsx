import { memo, useState } from "react";
import { number } from "../shared/format.js";
import { CHUNK } from "./tree.js";

// 이보다 긴 문자열은 앞부분만 보이고 "모두 보기"로 편다
const LONG_TEXT = 300;
// "더 보기"의 둘째 단추가 한 번에 여는 항목 수
const BIG_STEP = 1000;

// 문자열과 키는 JSON에 적는 모양(큰따옴표, 역슬래시 표기)으로 보인다
const quote = JSON.stringify;

// 앞에서 length자를 자른다. 이모지 같은 두 칸짜리 글자의 가운데는 자르지 않는다
function head(value, length) {
  const code = value.charCodeAt(length - 1);
  return value.slice(0, code >= 0xd800 && code <= 0xdbff ? length - 1 : length);
}

function Text({ value }) {
  const [all, setAll] = useState(false);
  if (value.length <= LONG_TEXT) return <span className="json-string">{quote(value)}</span>;
  if (all) {
    return (
      <>
        <span className="json-string">{quote(value)}</span>
        <button type="button" className="json-link" onClick={() => setAll(false)}>
          줄이기
        </button>
      </>
    );
  }
  return (
    <>
      <span className="json-string">{quote(head(value, LONG_TEXT)).slice(0, -1)}</span>
      <span className="json-ellipsis">…</span>
      <span className="json-string">"</span>
      <button type="button" className="json-link" onClick={() => setAll(true)}>
        모두 보기 ({number(value.length)}자)
      </button>
    </>
  );
}

function Scalar({ node }) {
  switch (node.type) {
    case "string":
      return <Text value={node.value} />;
    case "number":
      return <span className="json-number">{node.raw}</span>;
    case "boolean":
      return <span className="json-boolean">{String(node.value)}</span>;
    case "null":
      return <span className="json-null">null</span>;
    default:
      // 빈 객체·배열
      return <span className="json-punct">{node.type === "object" ? "{}" : "[]"}</span>;
  }
}

// 화면의 한 줄. 줄의 종류(kind)와 나머지 값은 tree.js의 visibleRows가 만든다.
// 줄은 겹쳐 넣지 않고 나란히 두며, 들여쓰기는 깊이(--depth)로 한다
// showIndex: 배열 항목 앞에 번호를 보일지 (옵션, 기본은 보이지 않는다)
const Row = memo(function Row({ kind, node, depth, name, index, showIndex, dup, comma, count, rest, onToggle, onMore }) {
  const style = { "--depth": depth };
  if (kind === "more") {
    return (
      <div className="json-row" style={style}>
        <span className="json-gutter" />
        <span className="json-body">
          <span className="json-ellipsis">… {number(rest)}개 더 있습니다</span>
          <button type="button" className="json-link" onClick={() => onMore(node, CHUNK)}>
            {rest > CHUNK ? `${CHUNK}개 더 보기` : "모두 보기"}
          </button>
          {rest > CHUNK && (
            <button type="button" className="json-link" onClick={() => onMore(node, BIG_STEP)}>
              {rest > BIG_STEP ? `${number(BIG_STEP)}개 더 보기` : "모두 보기"}
            </button>
          )}
        </span>
      </div>
    );
  }
  const [opening, closing] = node.type === "object" ? ["{", "}"] : ["[", "]"];
  if (kind === "end") {
    return (
      <div className="json-row" style={style}>
        <span className="json-gutter" />
        <span className="json-body">
          <span className="json-punct">{closing}</span>
          {comma && <span className="json-punct">,</span>}
        </span>
      </div>
    );
  }
  const foldable = kind === "open" || kind === "closed";
  const isOpen = kind === "open";
  // 펼치고 접는 단추의 이름 (화면 읽기 프로그램용)
  const target = name !== undefined ? quote(name) : index !== undefined ? `${index}번 항목` : "전체";
  // Alt(맥은 ⌥)를 누른 채 누르면 그 아래까지 모두 펼치거나 접는다
  const fold = (event) => onToggle(node, event.altKey);
  // 괄호 쪽은 글을 끌어서 고르다가 놓은 것이면 접지 않는다
  const foldUnlessSelecting = (event) => {
    if (getSelection().isCollapsed) fold(event);
  };
  return (
    <div className="json-row" style={style}>
      <span className="json-gutter">
        {foldable && (
          <button type="button" className="json-toggle" aria-expanded={isOpen} aria-label={`${target} ${isOpen ? "접기" : "펼치기"}`} onClick={fold} />
        )}
      </span>
      <span className="json-body">
        {name !== undefined && (
          <>
            <span className="json-key">{quote(name)}</span>
            {dup && (
              <span className="json-badge" title="이 객체에 같은 키가 또 있습니다. 대부분의 프로그램은 뒤에 나온 값만 씁니다.">
                겹친 키
              </span>
            )}
            <span className="json-punct">: </span>
          </>
        )}
        {showIndex && index !== undefined && <span className="json-index">{index}</span>}
        {foldable ? (
          // 괄호 쪽을 눌러도 펼치고 접는다. 키는 두 번 눌러 골라 복사할 수 있게 누르는 곳에서 뺐다
          <span className="json-fold" onClick={foldUnlessSelecting}>
            <span className="json-punct">{opening}</span>
            {!isOpen && (
              <>
                <span className="json-ellipsis"> … </span>
                <span className="json-punct">{closing}</span>
              </>
            )}
            <span className="json-count">{number(count)}개</span>
          </span>
        ) : (
          <Scalar node={node} />
        )}
        {comma && <span className="json-punct">,</span>}
      </span>
    </div>
  );
});

export default function Tree({ rows, showIndex, onToggle, onMore }) {
  return (
    <div className="json-tree" role="group" aria-label="JSON 구조">
      {rows.map((row) => (
        <Row
          key={row.id}
          kind={row.kind}
          node={row.node}
          depth={row.depth}
          name={row.name}
          index={row.index}
          showIndex={showIndex}
          dup={row.dup}
          comma={row.comma}
          count={row.count}
          rest={row.rest}
          onToggle={onToggle}
          onMore={onMore}
        />
      ))}
    </div>
  );
}
