import { styleText } from 'node:util';

type StyleFormat = Parameters<typeof styleText>[0];

const color =
  (format: StyleFormat) =>
  (text: string): string =>
    styleText(format, text);

const colors = {
  black: color('black'),
  red: color('red'),
  green: color('green'),
  yellow: color('yellow'),
  blue: color('blue'),
  magenta: color('magenta'),
  cyan: color('cyan'),
  white: color('white'),
  gray: color('gray'),
  // 'grey' is an alias for 'gray' (same ANSI bright-black), matching picocolors
  grey: color('gray')
};

export const {
  black,
  red,
  green,
  yellow,
  blue,
  magenta,
  cyan,
  white,
  gray,
  grey
} = colors;

export default colors;
