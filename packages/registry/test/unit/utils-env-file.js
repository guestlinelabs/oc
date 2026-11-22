const expect = require('chai').expect;

const { parseEnvFile } = require('../../dist/utils/env-file');

describe('utils : env-file', () => {
  it('parses basic key/value pairs', () => {
    expect(parseEnvFile('VAR1=VAL1\nVAR2=VAL2\n')).to.deep.equal({
      VAR1: 'VAL1',
      VAR2: 'VAL2'
    });
  });

  it('handles empty content', () => {
    expect(parseEnvFile('')).to.deep.equal({});
    expect(parseEnvFile('\n\n  \n')).to.deep.equal({});
  });

  it('skips comments and blank lines', () => {
    expect(
      parseEnvFile('# a comment\n\nVAR1=VAL1 # inline\n  # indented\nVAR2=VAL2')
    ).to.deep.equal({ VAR1: 'VAL1', VAR2: 'VAL2' });
  });

  it('supports the export prefix', () => {
    expect(parseEnvFile('export VAR1=VAL1\nexport  VAR2 = VAL2')).to.deep.equal(
      {
        VAR1: 'VAL1',
        VAR2: 'VAL2'
      }
    );
  });

  it('supports colon separators', () => {
    // like dotenv, ':' must directly follow the key and be followed by space
    expect(parseEnvFile('VAR1: VAL1\nVAR2:  VAL2')).to.deep.equal({
      VAR1: 'VAL1',
      VAR2: 'VAL2'
    });
    expect(parseEnvFile('VAR3:VAL3')).to.deep.equal({});
    expect(parseEnvFile('VAR4 : VAL4')).to.deep.equal({});
  });

  it('trims whitespace around keys, separators and unquoted values', () => {
    expect(parseEnvFile('  VAR1  =  VAL1  \n\tVAR2\t=\tVAL2\t')).to.deep.equal({
      VAR1: 'VAL1',
      VAR2: 'VAL2'
    });
  });

  it('supports single, double and backtick quoted values', () => {
    expect(
      parseEnvFile("A='single'\nB=\"double\"\nC=`backtick`\nD='has # hash'")
    ).to.deep.equal({
      A: 'single',
      B: 'double',
      C: 'backtick',
      D: 'has # hash'
    });
  });

  it('expands \\n and \\r escapes inside double quotes only', () => {
    expect(
      parseEnvFile('A="line1\\nline2"\nB=\'line1\\nline2\'')
    ).to.deep.equal({
      A: 'line1\nline2',
      B: 'line1\\nline2'
    });
  });

  it('keeps = and # behaviour consistent with dotenv', () => {
    // unquoted values cannot contain # (treated as comment start)
    expect(parseEnvFile('A=abc#def')).to.deep.equal({ A: 'abc' });
    // but = inside a value is fine
    expect(parseEnvFile('A=b=c')).to.deep.equal({ A: 'b=c' });
  });

  it('supports empty values', () => {
    expect(parseEnvFile('A=\nB=\nC=   ')).to.deep.equal({
      A: '',
      B: '',
      C: ''
    });
  });

  it('lets later duplicates win', () => {
    expect(parseEnvFile('A=1\nA=2')).to.deep.equal({ A: '2' });
  });

  it('normalises CRLF and CR line endings', () => {
    expect(parseEnvFile('A=1\r\nB=2\rC=3')).to.deep.equal({
      A: '1',
      B: '2',
      C: '3'
    });
  });

  it('allows dots and dashes in keys', () => {
    expect(parseEnvFile('my.key-name=value')).to.deep.equal({
      'my.key-name': 'value'
    });
  });
});
