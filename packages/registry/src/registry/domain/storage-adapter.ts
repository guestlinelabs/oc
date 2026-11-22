const privateComponentFilePatterns = [/(\\|\/)server\.js/, /(\\|\/)\..+/];

export function isPrivateComponentFile(filePath: string): boolean {
  return privateComponentFilePatterns.some((pattern) => pattern.test(filePath));
}
