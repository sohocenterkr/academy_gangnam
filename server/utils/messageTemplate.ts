const VARIABLE_PATTERN = /\{\{\s*([^}]+?)\s*\}\}/g;

export function renderMessageBody(body: string, variables: Record<string, string>): string {
  return body.replace(VARIABLE_PATTERN, (match, key: string) => {
    const value = variables[key];
    return value !== undefined ? value : match;
  });
}

/**
 * Korean SMS gateways classify by byte length in EUC-KR, where every character (Korean or
 * ASCII) costs 2 bytes — counting by codepoint gives the same result without needing an
 * EUC-KR encoder, since this only needs the boundary, not exact wire bytes.
 */
export function classifyMessageLength(body: string): 'SMS' | 'LMS' {
  const byteLength = [...body].length * 2;
  return byteLength <= 90 ? 'SMS' : 'LMS';
}
