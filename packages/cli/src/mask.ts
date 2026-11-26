/**
 * What a hidden prompt echoes: the escape sequences and line ends as they are, a dot in place of
 * every other character.
 */
export function maskEcho(s: string): string {
  return s
    .split(/(\x1b\[[0-9;?]*[A-Za-z])/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/[^\r\n]/g, '•')))
    .join('');
}
