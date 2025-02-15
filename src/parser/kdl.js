/**
 * @namespace kdl
 * @memberof module:kdljs.parser
 */

import { Lexer, MismatchedTokenException, createTokenInstance } from 'chevrotain'
import { BaseParser } from './base.js'
import * as Tokens from './tokens.js'

const tokens = {
  defaultMode: 'main',
  modes: {
    main: [
      Tokens.WhiteSpace,
      Tokens.BOM,
      Tokens.NewLine,
      Tokens.BlockComment,
      Tokens.LineComment,
      Tokens.OpenMultiLineComment,
      Tokens.Boolean,
      Tokens.Null,
      Tokens.FloatKeyword,
      Tokens.MultiLineRawString,
      Tokens.RawString,
      Tokens.Integer,
      Tokens.Float,
      Tokens.SemiColon,
      Tokens.Equals,
      Tokens.LeftBrace,
      Tokens.RightBrace,
      Tokens.LeftParenthesis,
      Tokens.RightParenthesis,
      Tokens.EscLine,
      Tokens.MultiLineOpenQuote,
      Tokens.OpenQuote,
      Tokens.Identifier
    ],
    multilineComment: [
      Tokens.OpenMultiLineComment,
      Tokens.CloseMultiLineComment,
      Tokens.MultiLineCommentContent
    ],
    string: [
      Tokens.Unicode,
      Tokens.Escape,
      Tokens.UnicodeEscape,
      Tokens.WhiteSpaceEscape,
      Tokens.CloseQuote
    ],
    multilineString: [
      Tokens.MultiLineCloseQuote,
      Tokens.MultiLineSingleQuote,
      Tokens.NewLine,
      Tokens.WhiteSpace,
      Tokens.Unicode,
      Tokens.Escape,
      Tokens.UnicodeEscape,
      Tokens.WhiteSpaceEscape
    ]
  }
}

const nodeEndTokens = new Set([
  Tokens.RightBrace,
  Tokens.LineComment,
  Tokens.NewLine,
  Tokens.SemiColon,
  Tokens.EOF
])

/**
 * @class
 * @extends module:kdljs.parser.base.BaseParser
 * @memberof module:kdljs.parser.kdl
 */
class KdlParser extends BaseParser {
  constructor () {
    super(tokens)

    /**
     * Consume a KDL document
     * @method #document
     * @memberof module:kdljs.parser.kdl.KdlParser
     * @return {module:kdljs~Document}
     */
    this.RULE('document', () => {
      this.OPTION(() => this.CONSUME(Tokens.BOM))
      const nodes = this.SUBRULE(this.nodes)
      this.CONSUME(Tokens.EOF)
      return nodes
    })

    /**
     * Consume a sequence of KDL nodes
     * @method #nodes
     * @memberof module:kdljs.parser.kdl.KdlParser
     * @return {module:kdljs~Document}
     */
    this.RULE('nodes', () => {
      const nodes = []

      this.MANY(() => this.OR([
        {
          ALT: () => {
            this.CONSUME(Tokens.BlockComment)
            this.OPTION1(() => this.SUBRULE(this.lineSpace))
            this.SUBRULE(this.node)
          }
        },
        { ALT: () => this.SUBRULE1(this.lineSpace) },
        { ALT: () => nodes.push(this.SUBRULE1(this.node)) }
      ]))

      return nodes
    })

    /**
     * Consume a KDL node
     * @method #node
     * @memberof module:kdljs.parser.kdl.KdlParser
     * @return {module:kdljs~Node}
     */
    this.RULE('node', () => {
      const node = {
        name: undefined,
        properties: {},
        values: [],
        children: [],
        tags: {
          name: undefined,
          properties: {},
          values: []
        }
      }

      this.OPTION(() => {
        node.tags.name = this.SUBRULE(this.tag)
        this.OPTION1(() => this.SUBRULE(this.nodeSpace))
      })

      node.name = this.SUBRULE(this.string)

      let entriesEnded = false
      let childrenEnded = false

      let hasSpace = this.OPTION2(() => this.SUBRULE1(this.nodeSpace))

      this.MANY({
        GATE: () => hasSpace && !nodeEndTokens.has(this.LA(1).tokenType),
        DEF: () => {
          this.OR([
            {
              GATE: () => !entriesEnded,
              ALT: () => {
                const parts = this.SUBRULE(this.propertyOrArgument)
                if (parts[0] != null) {
                  node.properties[parts[0]] = parts[1]
                  node.tags.properties[parts[0]] = parts[2]
                } else {
                  node.values.push(parts[1])
                  node.tags.values.push(parts[2])
                }
                hasSpace = parts[3]
              }
            },
            {
              GATE: () => !childrenEnded,
              ALT: () => {
                node.children = this.SUBRULE(this.nodeChildren)
                entriesEnded = true
                childrenEnded = true
                hasSpace = this.OPTION3(() => this.SUBRULE2(this.nodeSpace))
              }
            },
            {
              ALT: () => {
                this.CONSUME(Tokens.BlockComment)
                this.OPTION4(() => this.SUBRULE(this.lineSpace))
                this.OR1([
                  {
                    GATE: () => !entriesEnded,
                    ALT: () => {
                      const parts = this.SUBRULE1(this.propertyOrArgument)
                      hasSpace = parts[3]
                    }
                  },
                  {
                    ALT: () => {
                      this.SUBRULE1(this.nodeChildren)
                      entriesEnded = true
                      hasSpace = this.OPTION5(() => this.SUBRULE3(this.nodeSpace))
                    }
                  }
                ])
              }
            }
          ])
        }
      })

      if (this.LA(1).tokenType !== Tokens.RightBrace) {
        this.SUBRULE(this.nodeTerminator)
      }

      return node
    })

    /**
     * Consume a property or an argument
     * @method #propertyOrArgument
     * @memberof module:kdljs.parser.kdl.KdlParser
     * @return {Array<module:kdljs~Value>} key-value-type tuple
     */
    this.RULE('propertyOrArgument', () => {
      return this.OR([
        {
          ALT: () => {
            const tag = this.SUBRULE(this.tag)
            this.OPTION(() => this.SUBRULE(this.nodeSpace))
            const value = this.SUBRULE(this.value)
            const hasSpaceAfter = this.OPTION1(() => this.SUBRULE1(this.nodeSpace))
            return [undefined, value, tag, hasSpaceAfter]
          }
        },
        {
          ALT: () => {
            const value = this.SUBRULE(this.nonStringValue)
            const hasSpaceAfter = this.OPTION2(() => this.SUBRULE2(this.nodeSpace))
            return [undefined, value, undefined, hasSpaceAfter]
          }
        },
        {
          ALT: () => {
            let name
            let tag

            let value = this.SUBRULE(this.string)
            let hasSpaceAfter = this.OPTION3(() => this.SUBRULE3(this.nodeSpace))

            this.OPTION4(() => {
              this.CONSUME(Tokens.Equals)
              this.OPTION5(() => this.SUBRULE4(this.nodeSpace))

              name = value

              tag = this.OPTION6(() => {
                const tag = this.SUBRULE1(this.tag)
                this.OPTION7(() => this.SUBRULE5(this.nodeSpace))
                return tag
              })

              value = this.SUBRULE1(this.value)
              hasSpaceAfter = this.OPTION8(() => this.SUBRULE6(this.nodeSpace))
            })

            return [name, value, tag, hasSpaceAfter]
          }
        }
      ])
    })

    /**
     * Consume node children
     * @method #nodeChildren
     * @memberof module:kdljs.parser.kdl.KdlParser
     * @return {module:kdljs~Document}
     */
    this.RULE('nodeChildren', () => {
      this.CONSUME(Tokens.LeftBrace)
      const nodes = this.SUBRULE(this.nodes)
      this.CONSUME(Tokens.RightBrace)
      return nodes
    })

    /**
     * Consume line space
     * @method #lineSpace
     * @memberof module:kdljs.parser.kdl.KdlParser
     */
    this.RULE('lineSpace', () => {
      this.AT_LEAST_ONE(() => this.OR([
        { ALT: () => this.SUBRULE(this.nodeSpace) },
        { ALT: () => this.CONSUME(Tokens.NewLine) },
        { ALT: () => this.SUBRULE(this.lineComment) }
      ]))
    })

    /**
     * Consume a node terminator
     * @method #nodeTerminator
     * @memberof module:kdljs.parser.kdl.KdlParser
     */
    this.RULE('nodeTerminator', () => {
      this.OR([
        { ALT: () => this.SUBRULE(this.lineComment) },
        { ALT: () => this.CONSUME(Tokens.NewLine) },
        { ALT: () => this.CONSUME(Tokens.SemiColon) },
        { ALT: () => this.CONSUME(Tokens.EOF) }
      ])
    })

    this.performSelfAnalysis()
  }
}

/**
 * @access private
 * @memberof module:kdljs.parser.kdl
 * @param {Object} error
 * @param {string} error.message
 * @param {number} error.offset
 * @param {number} error.length
 * @param {number} error.line
 * @param {number} error.column
 * @param {Object[]} tokens
 * @param {string} text
 * @return {Object}
 */
function transformLexerError (error, tokens, text) {
  const endOffset = error.offset + error.length
  const image = text.slice(error.offset, endOffset)
  const lines = image.split(/\r?\n/g)
  const prevToken = tokens.find(token => token.endOffset + 1 === error.offset)

  return new MismatchedTokenException(
    error.message,
    createTokenInstance(
      Tokens.Unknown,
      image,
      error.offset,
      endOffset,
      error.line,
      error.line + lines.length - 1,
      error.column,
      error.column + lines[lines.length - 1].length
    ),
    prevToken
  )
}

const lexer = new Lexer(tokens)
/**
 * @constant {module:kdljs.parser.kdl.KdlParser}
 * @memberof module:kdljs.parser.kdl
 */
const parser = new KdlParser()

/**
 * @typedef ParseResult
 * @memberof module:kdljs.parser.kdl
 * @type {Object}
 * @property {Array} errors - Parsing errors
 * @property {module:kdljs~Document} output - KDL Document
 */

/**
 * @function parse
 * @memberof module:kdljs.parser.kdl
 * @param {string} text - Input KDL file (or fragment)
 * @return {module:kdljs.parser.kdl.ParseResult} Output
 */
export function parse (text) {
  const { tokens, errors } = lexer.tokenize(text)

  if (errors.length) {
    return {
      output: undefined,
      errors: errors.map(error => transformLexerError(error, tokens, text))
    }
  }

  parser.input = tokens
  const output = parser.document()

  return {
    output,
    errors: parser.errors
  }
}

export {
  lexer,
  parser,
  KdlParser
}
