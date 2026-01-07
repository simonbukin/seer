/**
 * Language Transformer - Core deinflection engine
 * Ported from Yomitan (https://github.com/yomidevs/yomitan)
 *
 * Copyright (C) 2024-2025 Yomitan Authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Types for the transformer
export interface TraceFrame {
  transform: string;
  ruleIndex: number;
  text: string;
}

export type Trace = TraceFrame[];

export interface TransformedText {
  text: string;
  conditions: number;
  trace: Trace;
}

export interface Rule<TCondition extends string = string> {
  type: 'suffix' | 'prefix' | 'wholeWord';
  isInflected: RegExp;
  deinflect: (text: string) => string;
  conditionsIn: number;
  conditionsOut: number;
}

export interface Transform {
  id: string;
  name: string;
  description?: string;
  rules: Rule[];
  heuristic: RegExp;
}

export interface Condition {
  name: string;
  isDictionaryForm: boolean;
  subConditions?: string[];
  i18n?: Array<{ language: string; name: string; description?: string }>;
}

export interface LanguageTransformDescriptor<TCondition extends string = string> {
  language: string;
  conditions: Record<TCondition, Condition>;
  transforms: Record<string, {
    name: string;
    description?: string;
    i18n?: Array<{ language: string; name: string; description?: string }>;
    rules: Array<{
      type: 'suffix' | 'prefix' | 'wholeWord';
      isInflected: RegExp;
      deinflect: (text: string) => string;
      conditionsIn: TCondition[];
      conditionsOut: TCondition[];
    }>;
  }>;
}

export class LanguageTransformer {
  private _nextFlagIndex = 0;
  private _transforms: Transform[] = [];
  private _conditionTypeToConditionFlagsMap = new Map<string, number>();
  private _partOfSpeechToConditionFlagsMap = new Map<string, number>();

  clear(): void {
    this._nextFlagIndex = 0;
    this._transforms = [];
    this._conditionTypeToConditionFlagsMap.clear();
    this._partOfSpeechToConditionFlagsMap.clear();
  }

  addDescriptor<TCondition extends string>(
    descriptor: LanguageTransformDescriptor<TCondition>
  ): void {
    const { conditions, transforms } = descriptor;
    const conditionEntries = Object.entries(conditions) as [TCondition, Condition][];
    const { conditionFlagsMap, nextFlagIndex } = this._getConditionFlagsMap(
      conditionEntries,
      this._nextFlagIndex
    );

    const transforms2: Transform[] = [];

    for (const [transformId, transform] of Object.entries(transforms)) {
      const { name, description, rules } = transform as {
        name: string;
        description?: string;
        rules: Array<{
          type: 'suffix' | 'prefix' | 'wholeWord';
          isInflected: RegExp;
          deinflect: (text: string) => string;
          conditionsIn: TCondition[];
          conditionsOut: TCondition[];
        }>;
      };

      const rules2: Rule[] = [];
      for (let j = 0; j < rules.length; ++j) {
        const { type, isInflected, deinflect, conditionsIn, conditionsOut } = rules[j];
        const conditionFlagsIn = this._getConditionFlagsStrict(conditionFlagsMap, conditionsIn);
        if (conditionFlagsIn === null) {
          throw new Error(`Invalid conditionsIn for transform ${transformId}.rules[${j}]`);
        }
        const conditionFlagsOut = this._getConditionFlagsStrict(conditionFlagsMap, conditionsOut);
        if (conditionFlagsOut === null) {
          throw new Error(`Invalid conditionsOut for transform ${transformId}.rules[${j}]`);
        }
        rules2.push({
          type,
          isInflected,
          deinflect,
          conditionsIn: conditionFlagsIn,
          conditionsOut: conditionFlagsOut,
        });
      }

      const isInflectedTests = rules.map((rule) => rule.isInflected);
      const heuristic = new RegExp(isInflectedTests.map((regExp) => regExp.source).join('|'));
      transforms2.push({ id: transformId, name, description, rules: rules2, heuristic });
    }

    this._nextFlagIndex = nextFlagIndex;
    for (const transform of transforms2) {
      this._transforms.push(transform);
    }

    for (const [type, condition] of conditionEntries) {
      const flags = conditionFlagsMap.get(type);
      if (flags === undefined) continue;
      this._conditionTypeToConditionFlagsMap.set(type, flags);
      if (condition.isDictionaryForm) {
        this._partOfSpeechToConditionFlagsMap.set(type, flags);
      }
    }
  }

  getConditionFlagsFromPartsOfSpeech(partsOfSpeech: string[]): number {
    return this._getConditionFlags(this._partOfSpeechToConditionFlagsMap, partsOfSpeech);
  }

  getConditionFlagsFromConditionTypes(conditionTypes: string[]): number {
    return this._getConditionFlags(this._conditionTypeToConditionFlagsMap, conditionTypes);
  }

  getConditionFlagsFromConditionType(conditionType: string): number {
    return this._getConditionFlags(this._conditionTypeToConditionFlagsMap, [conditionType]);
  }

  /**
   * Transform a source text through all possible deinflection paths.
   * Uses breadth-first search to find all valid deinflections.
   */
  transform(sourceText: string): TransformedText[] {
    const results: TransformedText[] = [
      LanguageTransformer.createTransformedText(sourceText, 0, []),
    ];

    for (let i = 0; i < results.length; ++i) {
      const { text, conditions, trace } = results[i];

      for (const transform of this._transforms) {
        if (!transform.heuristic.test(text)) continue;

        const { id, rules } = transform;
        for (let j = 0; j < rules.length; ++j) {
          const rule = rules[j];
          if (!LanguageTransformer.conditionsMatch(conditions, rule.conditionsIn)) continue;

          const { isInflected, deinflect } = rule;
          if (!isInflected.test(text)) continue;

          // Cycle detection
          const isCycle = trace.some(
            (frame) => frame.transform === id && frame.ruleIndex === j && frame.text === text
          );
          if (isCycle) {
            console.warn(
              `[LanguageTransformer] Cycle detected in transform[${id}] rule[${j}] for text: ${text}`
            );
            continue;
          }

          results.push(
            LanguageTransformer.createTransformedText(
              deinflect(text),
              rule.conditionsOut,
              this._extendTrace(trace, { transform: id, ruleIndex: j, text })
            )
          );
        }
      }
    }

    return results;
  }

  /**
   * Get user-facing names for inflection rules in a trace
   */
  getUserFacingInflectionRules(inflectionRules: string[]): Array<{ name: string; description?: string }> {
    return inflectionRules.map((rule) => {
      const fullRule = this._transforms.find((transform) => transform.id === rule);
      if (fullRule === undefined) return { name: rule };
      const { name, description } = fullRule;
      return description ? { name, description } : { name };
    });
  }

  static createTransformedText(text: string, conditions: number, trace: Trace): TransformedText {
    return { text, conditions, trace };
  }

  /**
   * Check if conditions match.
   * If currentConditions is 0, any condition matches.
   * Otherwise, there must be at least one shared condition.
   */
  static conditionsMatch(currentConditions: number, nextConditions: number): boolean {
    return currentConditions === 0 || (currentConditions & nextConditions) !== 0;
  }

  private _getConditionFlagsMap(
    conditions: [string, Condition][],
    nextFlagIndex: number
  ): { conditionFlagsMap: Map<string, number>; nextFlagIndex: number } {
    const conditionFlagsMap = new Map<string, number>();
    let targets = conditions;

    while (targets.length > 0) {
      const nextTargets: [string, Condition][] = [];

      for (const target of targets) {
        const [type, condition] = target;
        const { subConditions } = condition;
        let flags = 0;

        if (subConditions === undefined) {
          if (nextFlagIndex >= 32) {
            throw new Error('Maximum number of conditions was exceeded');
          }
          flags = 1 << nextFlagIndex;
          ++nextFlagIndex;
        } else {
          const multiFlags = this._getConditionFlagsStrict(conditionFlagsMap, subConditions);
          if (multiFlags === null) {
            nextTargets.push(target);
            continue;
          } else {
            flags = multiFlags;
          }
        }
        conditionFlagsMap.set(type, flags);
      }

      if (nextTargets.length === targets.length) {
        throw new Error('Maximum number of conditions was exceeded');
      }
      targets = nextTargets;
    }

    return { conditionFlagsMap, nextFlagIndex };
  }

  private _getConditionFlagsStrict(
    conditionFlagsMap: Map<string, number>,
    conditionTypes: string[]
  ): number | null {
    let flags = 0;
    for (const conditionType of conditionTypes) {
      const flags2 = conditionFlagsMap.get(conditionType);
      if (flags2 === undefined) {
        return null;
      }
      flags |= flags2;
    }
    return flags;
  }

  private _getConditionFlags(
    conditionFlagsMap: Map<string, number>,
    conditionTypes: string[]
  ): number {
    let flags = 0;
    for (const conditionType of conditionTypes) {
      const flags2 = conditionFlagsMap.get(conditionType);
      if (flags2 !== undefined) {
        flags |= flags2;
      }
    }
    return flags;
  }

  private _extendTrace(trace: Trace, newFrame: TraceFrame): Trace {
    const newTrace = [newFrame];
    for (const { transform, ruleIndex, text } of trace) {
      newTrace.push({ transform, ruleIndex, text });
    }
    return newTrace;
  }
}

// Helper functions for creating inflection rules

/**
 * Create a suffix-based deinflection rule
 */
export function suffixInflection<TCondition extends string>(
  inflectedSuffix: string,
  deinflectedSuffix: string,
  conditionsIn: TCondition[],
  conditionsOut: TCondition[]
): {
  type: 'suffix';
  isInflected: RegExp;
  deinflect: (text: string) => string;
  conditionsIn: TCondition[];
  conditionsOut: TCondition[];
} {
  const suffixRegExp = new RegExp(inflectedSuffix + '$');
  return {
    type: 'suffix',
    isInflected: suffixRegExp,
    deinflect: (text) => text.slice(0, -inflectedSuffix.length) + deinflectedSuffix,
    conditionsIn,
    conditionsOut,
  };
}

/**
 * Create a prefix-based deinflection rule
 */
export function prefixInflection<TCondition extends string>(
  inflectedPrefix: string,
  deinflectedPrefix: string,
  conditionsIn: TCondition[],
  conditionsOut: TCondition[]
): {
  type: 'prefix';
  isInflected: RegExp;
  deinflect: (text: string) => string;
  conditionsIn: TCondition[];
  conditionsOut: TCondition[];
} {
  const prefixRegExp = new RegExp('^' + inflectedPrefix);
  return {
    type: 'prefix',
    isInflected: prefixRegExp,
    deinflect: (text) => deinflectedPrefix + text.slice(inflectedPrefix.length),
    conditionsIn,
    conditionsOut,
  };
}

/**
 * Create a whole-word deinflection rule
 */
export function wholeWordInflection<TCondition extends string>(
  inflectedWord: string,
  deinflectedWord: string,
  conditionsIn: TCondition[],
  conditionsOut: TCondition[]
): {
  type: 'wholeWord';
  isInflected: RegExp;
  deinflect: (text: string) => string;
  conditionsIn: TCondition[];
  conditionsOut: TCondition[];
} {
  const regex = new RegExp('^' + inflectedWord + '$');
  return {
    type: 'wholeWord',
    isInflected: regex,
    deinflect: () => deinflectedWord,
    conditionsIn,
    conditionsOut,
  };
}
