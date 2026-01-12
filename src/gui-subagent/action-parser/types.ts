/*
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */

export type Coords = [number, number] | [];

export type ActionInputs = Partial<{
  content: string;
  start_box: string;
  end_box: string;
  key: string;
  hotkey: string;
  direction: string;
  start_coords: Coords;
  end_coords: Coords;
}>;

export interface PredictionParsed {
  action_inputs: ActionInputs;
  reflection: string | null;
  action_type: string;
  thought: string;
}

export enum UITarsModelVersion {
  V1_0 = '1.0',
  V1_5 = '1.5',
  DOUBAO_1_5_15B = 'doubao-1.5-15B',
  DOUBAO_1_5_20B = 'doubao-1.5-20B',
}
