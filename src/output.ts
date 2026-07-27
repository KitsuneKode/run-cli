let forceNoColor = false;

export function setForceNoColor(value: boolean): void {
  forceNoColor = value;
}

function isColorEnabled(): boolean {
  return (
    !forceNoColor &&
    Boolean(process.stdout.isTTY) &&
    process.env.NO_COLOR === undefined &&
    process.env.TERM !== "dumb"
  );
}

function paint(code: string, value: string): string {
  return isColorEnabled() ? `\u001B[${code}m${value}\u001B[0m` : value;
}

export function bold(value: string): string {
  return paint("1", value);
}

export function cyan(value: string): string {
  return paint("36", value);
}

export function blue(value: string): string {
  return paint("34", value);
}

export function green(value: string): string {
  return paint("32", value);
}

export function yellow(value: string): string {
  return paint("33", value);
}

export function red(value: string): string {
  return paint("31", value);
}

export function dim(value: string): string {
  return paint("2", value);
}

export function white(value: string): string {
  return paint("37", value);
}

export function magenta(value: string): string {
  return paint("35", value);
}

export function info(message: string): void {
  console.log(message);
}

export function warn(message: string): void {
  console.warn(yellow(message));
}

export function fail(message: string): never {
  throw new Error(message);
}

export function stripAnsi(value: string): string {
  // Matches all ANSI escape sequences
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally matching ANSI escape code
  return value.replace(/\x1B\[\d+m/g, "");
}
