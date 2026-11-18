// 읽기 모드 코드 블록 문법 강조. 편집기와 같은 Lezer 문법을 써서 색이 일관되게 한다.
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { classHighlighter, highlightCode } from '@lezer/highlight';

export async function highlightInto(codeEl: HTMLElement, langName: string): Promise<void> {
  const desc = LanguageDescription.matchLanguageName(languages, langName, true);
  if (!desc) return;
  const support = desc.support ?? (await desc.load());
  const code = codeEl.textContent ?? '';
  const tree = support.language.parser.parse(code);
  const frag = document.createDocumentFragment();
  highlightCode(
    code,
    tree,
    classHighlighter,
    (text, classes) => {
      if (!classes) frag.append(text);
      else {
        const s = document.createElement('span');
        s.className = classes;
        s.textContent = text;
        frag.append(s);
      }
    },
    () => frag.append('\n'),
  );
  codeEl.replaceChildren(frag);
}
