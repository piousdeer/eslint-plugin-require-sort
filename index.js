'use strict';

module.exports = {
  rules: {
    'require-sort': {
      meta: {
        type: 'suggestion',

        docs: {
          description: 'enforce sorted require declarations within modules',
          category: 'ECMAScript 6',
          recommended: false,
          url: 'https://github.com/zcuric/eslint-plugin-require-sort'
        },
        schema: [
          {
            type: 'object',
            properties: {
              ignoreCase: {
                type: 'boolean',
                default: false
              },
              propertySyntaxSortOrder: {
                type: 'array',
                items: {
                  enum: ['none', 'multiple', 'single']
                },
                uniqueItems: true,
                minItems: 3,
                maxItems: 3
              },
              ignoreDeclarationSort: {
                type: 'boolean',
                default: false
              },
              ignorePropertySort: {
                type: 'boolean',
                default: false
              }
            },
            additionalProperties: false
          }
        ],

        fixable: 'code'
      },
      create(context) {
        const configuration = context.options[0] || {};
        const {
          ignoreCase = false,
          ignoreDeclarationSort = false,
          ignorePropertySort = false,
          propertySyntaxSortOrder = ['none', 'multiple', 'single']
        } = configuration;
        const sourceCode = context.getSourceCode();
        const nodes = [];
        let previousDeclaration = null;

        const isTopLevel = ({ parent }) => parent.type === 'Program';
        const isStaticRequire = node => {
          if (node.type !== 'CallExpression') return false;
          return node.callee &&
            node.callee.type === 'Identifier' &&
            node.callee.name === 'require' &&
            node.arguments.length === 1;
        };
        const isRequire = node => node.declarations[0]?.init?.callee?.name === 'require';
        const hasObjectPattern = node => node.declarations[0]?.id?.type === 'ObjectPattern';
        const hasMultipleProperties = node => node.declarations[0]?.id?.properties.length > 1;
        const usedPropertySyntax = node => {
          if (isStaticRequire(node)) return 'none';
          if (!hasObjectPattern(node) || !hasMultipleProperties(node)) return 'single';
          return 'multiple';
        };
        const hasComments = properties => properties.some(property => {
          const commentsBefore = sourceCode.getCommentsBefore(property);
          const commentsAfter = sourceCode.getCommentsAfter(property);
          return commentsBefore.length || commentsAfter.length;
        });
        const getPropertyParameterGroupIndex = node =>
          propertySyntaxSortOrder.indexOf(usedPropertySyntax(node));
        const getFirstDeclarationName = node => {
          if (isStaticRequire(node)) return null;
          if (!hasObjectPattern(node)) return node.declarations[0].id.name;
          if (hasObjectPattern(node)) return node.declarations[0].id.properties[0].key.name;
          return null;
        };

        const handleDeclarationSort = node => {
          if (previousDeclaration) {
            const currentPropertySyntaxGroupIndex = getPropertyParameterGroupIndex(node);
            const previousPropertySyntaxGroupIndex = getPropertyParameterGroupIndex(previousDeclaration);

            /*
           * When the current declaration uses a different property syntax,
           * then check if the ordering is correct.
           * Otherwise, make a default string compare (like rule sort-vars to be consistent) of the first used property name.
           */
            if (currentPropertySyntaxGroupIndex !== previousPropertySyntaxGroupIndex) {
              if (currentPropertySyntaxGroupIndex < previousPropertySyntaxGroupIndex) {
                context.report({
                  node,
                  message: "Expected '{{syntaxA}}' syntax before '{{syntaxB}}' syntax.",
                  data: {
                    syntaxA: propertySyntaxSortOrder[currentPropertySyntaxGroupIndex],
                    syntaxB: propertySyntaxSortOrder[previousPropertySyntaxGroupIndex]
                  }
                });
              }
            } else {
              let currentDeclarationName = getFirstDeclarationName(node);
              let previousDeclarationName = getFirstDeclarationName(previousDeclaration);

              if (ignoreCase) {
                previousDeclarationName = previousDeclarationName && previousDeclarationName.toLowerCase();
                currentDeclarationName = currentDeclarationName && currentDeclarationName.toLowerCase();
              }
              if (previousDeclarationName && currentDeclarationName &&
                currentDeclarationName < previousDeclarationName
              ) {
                context.report({
                  node,
                  message: 'Requires should be sorted alphabetically.'
                });
              }
            }
          }

          previousDeclaration = node;
        };

        const handlePropertySort = node => {
          if (isStaticRequire(node)) return;
          if (!node.declarations[0].id.properties) return;
          const properties = node.declarations[0].id.properties;
          const getSortableName = ignoreCase
            ? property => property.key.name.toLowerCase()
            : property => property.key.name;
          const firstUnsortedIndex = properties.map(getSortableName)
            .findIndex((name, index, array) => array[index - 1] > name);

          if (firstUnsortedIndex !== -1) {
            context.report({
              node: properties[firstUnsortedIndex],
              message: "Property '{{propertyName}}' of the require declaration should be sorted alphabetically.",
              data: { propertyName: properties[firstUnsortedIndex].key.name },
              fix(fixer) {
                // If there are comments in the property list, don't rearrange the properties.
                if (hasComments(properties)) return null;

                const sortByName = (propertyA, propertyB) => {
                  const aName = getSortableName(propertyA);
                  const bName = getSortableName(propertyB);
                  return aName > bName ? 1 : -1;
                };

                const mergeText = (sourceText, property, index) => {
                  let textAfterProperty = '';
                  if (index !== properties.length - 1) {
                    textAfterProperty = sourceCode
                      .getText()
                      .slice(properties[index].range[1], properties[index + 1].range[0]);
                  }
                  return sourceText + sourceCode.getText(property) + textAfterProperty;
                };

                return fixer.replaceTextRange(
                  [properties[0].range[0], properties[properties.length - 1].range[1]],
                  properties.slice().sort(sortByName).reduce(mergeText, '')
                );
              }
            });
          }
        };

        return {
          ExpressionStatement(node) {
            if (!isTopLevel(node)) return;
            if (!isStaticRequire(node.expression)) return;
            nodes.push(node.expression);
          },
          VariableDeclaration(node) {
            if (!isTopLevel(node)) return;
            if (!isRequire(node)) return;
            nodes.push(node);
          },
          'Program:exit'() {
            if (!ignoreDeclarationSort) nodes.forEach(handleDeclarationSort);
            if (!ignorePropertySort) nodes.forEach(handlePropertySort);
          }
        };
      }
    }
  }
};
