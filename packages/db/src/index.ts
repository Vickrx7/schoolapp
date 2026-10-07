export type { Database, Json, Tables, TablesInsert, TablesUpdate, Enums } from './database.types';
export { Constants } from './database.types';

import type { Database } from './database.types';

export type AppRole = Database['public']['Enums']['app_role'];
export type BlockKind = Database['public']['Enums']['block_kind'];
export type CalendarEventType = Database['public']['Enums']['calendar_event_type'];
export type UnitStatus = Database['public']['Enums']['unit_status'];
export type LessonProgressStatus = Database['public']['Enums']['lesson_progress_status'];
export type ModuleKey = Database['public']['Enums']['module_key'];
export type AlertCategory = Database['public']['Enums']['alert_category'];
export type ScheduleType = Database['public']['Enums']['schedule_type'];
