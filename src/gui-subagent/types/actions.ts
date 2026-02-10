/**
 * GUI Action Types for xagent gui-subagent
 * Based on UI-TARS gui-agent implementation
 */

export interface Coordinates {
  raw?: { x: number; y: number };
  normalized?: { x: number; y: number };
  referenceBox?: { x1: number; y1: number; x2: number; y2: number };
  referenceSystem?: 'screen' | 'window' | 'browserPage' | string;
}

export interface BaseAction<T extends string = string, I extends Record<string, any> = Record<string, any>> {
  type: T;
  inputs: I;
  meta?: {
    toolHint?: string;
    comment?: string;
  };
}

export type ScreenShotAction = BaseAction<
  'screenshot',
  {
    start?: Coordinates;
    end?: Coordinates;
  }
>;

export type ClickAction = BaseAction<
  'click',
  {
    point: Coordinates;
  }
>;

export type RightClickAction = BaseAction<
  'right_click',
  {
    point: Coordinates;
  }
>;

export type DoubleClickAction = BaseAction<
  'double_click',
  {
    point: Coordinates;
  }
>;

export type MiddleClickAction = BaseAction<
  'middle_click',
  {
    point: Coordinates;
  }
>;

export type MouseDownAction = BaseAction<
  'mouse_down',
  {
    point?: Coordinates;
    button?: 'left' | 'right';
  }
>;

export type MouseUpAction = BaseAction<
  'mouse_up',
  {
    point?: Coordinates;
    button?: 'left' | 'right';
  }
>;

export type MouseMoveAction = BaseAction<
  'mouse_move',
  {
    point: Coordinates;
  }
>;

export type DragAction = BaseAction<
  'drag',
  {
    start: Coordinates;
    end: Coordinates;
    direction?: 'up' | 'down' | 'left' | 'right';
  }
>;

export type ScrollAction = BaseAction<
  'scroll',
  {
    point?: Coordinates;
    direction: 'up' | 'down' | 'left' | 'right';
  }
>;

export type TypeAction = BaseAction<
  'type',
  {
    content: string;
  }
>;

export type HotkeyAction = BaseAction<
  'hotkey',
  {
    key: string;
  }
>;

export type PressAction = BaseAction<
  'press',
  {
    key: string;
  }
>;

export type ReleaseAction = BaseAction<
  'release',
  {
    key: string;
  }
>;

export type LongPressAction = BaseAction<
  'long_press',
  {
    point: Coordinates;
  }
>;

export type SwipeAction = BaseAction<
  'swipe',
  {
    start: Coordinates;
    end: Coordinates;
    direction: 'up' | 'down' | 'left' | 'right';
  }
>;

export type HomeAction = BaseAction<'home' | 'press_home', Record<string, never>>;

export type BackAction = BaseAction<'back' | 'press_back', Record<string, never>>;

export type OpenAppAction = BaseAction<
  'open_app',
  {
    name: string;
  }
>;

export type WaitAction = BaseAction<
  'wait',
  {
    time?: number;
  }
>;

export type FinishAction = BaseAction<
  'finished',
  {
    content?: string;
  }
>;

export type OpenUrlAction = BaseAction<
  'open_url',
  {
    url: string;
  }
>;

export type OperationalGUIAction =
  | ClickAction
  | DoubleClickAction
  | RightClickAction
  | MiddleClickAction
  | MouseDownAction
  | MouseUpAction
  | MouseMoveAction
  | DragAction
  | ScrollAction
  | TypeAction
  | HotkeyAction
  | PressAction
  | ReleaseAction
  | LongPressAction
  | SwipeAction
  | HomeAction
  | BackAction
  | OpenAppAction
  | WaitAction
  | FinishAction;

export type GUIAction = ScreenShotAction | OperationalGUIAction;

export type SupportedActionType =
  | 'click'
  | 'left_click'
  | 'left_single'
  | 'left_double'
  | 'double_click'
  | 'right_click'
  | 'right_single'
  | 'middle_click'
  | 'mouse_down'
  | 'mouse_up'
  | 'mouse_move'
  | 'hover'
  | 'drag'
  | 'scroll'
  | 'type'
  | 'hotkey'
  | 'press'
  | 'release'
  | 'open_url'
  | 'long_press'
  | 'swipe'
  | 'home'
  | 'back'
  | 'open_app'
  | 'wait'
  | 'finished'
  | 'user_stop'
  | 'error_env'
  | 'call_user';

export const ACTION_METADATA: Record<SupportedActionType, { category: string; description: string }> = {
  click: { category: 'mouse', description: 'Click on an element' },
  left_click: { category: 'mouse', description: 'Left click on an element' },
  left_single: { category: 'mouse', description: 'Left single click on an element' },
  left_double: { category: 'mouse', description: 'Left double click on an element' },
  right_click: { category: 'mouse', description: 'Right click on an element' },
  right_single: { category: 'mouse', description: 'Right single click on an element' },
  double_click: { category: 'mouse', description: 'Double click on an element' },
  middle_click: { category: 'mouse', description: 'Middle click on an element' },
  mouse_down: { category: 'mouse', description: 'Press mouse button down' },
  mouse_up: { category: 'mouse', description: 'Release mouse button' },
  mouse_move: { category: 'mouse', description: 'Move mouse to position' },
  hover: { category: 'mouse', description: 'Hover on an element' },
  drag: { category: 'mouse', description: 'Drag from one position to another' },
  scroll: { category: 'mouse', description: 'Scroll in a direction' },
  type: { category: 'keyboard', description: 'Type text' },
  hotkey: { category: 'keyboard', description: 'Press hotkey combination' },
  press: { category: 'keyboard', description: 'Press a key' },
  release: { category: 'keyboard', description: 'Release a key' },
  open_url: { category: 'navigation', description: 'Open URL in default browser' },
  long_press: { category: 'mobile', description: 'Long press on element' },
  swipe: { category: 'mobile', description: 'Swipe gesture' },
  home: { category: 'mobile', description: 'Go to home' },
  back: { category: 'mobile', description: 'Go back' },
  open_app: { category: 'mobile', description: 'Open application' },
  wait: { category: 'wait', description: 'Wait for specified time' },
  finished: { category: 'system', description: 'Mark task as finished' },
  user_stop: { category: 'system', description: 'User stopped the task' },
  error_env: { category: 'system', description: 'Environment error' },
  call_user: { category: 'system', description: 'Call user for assistance' },
};

export function isSupportedActionType(type: string): type is SupportedActionType {
  return type in ACTION_METADATA;
}