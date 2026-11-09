// Device settings have their own mounted view and status endpoint. Receiving
// them through the portable-state mirror must not remount an academic editor.
const auxiliaryKeys=new Set(['armi_access_control_v1','armi_hybrid_numeric_scores_v1','armi_students_list_selection_v1','armi_students_hidden_columns_v1',
  'armi_fast_session_index_v1','armi_birthdays_toast_seen','armi_ai_usage_daily_v1','armi_general_notes_board_v1']);
const auxiliary=(key:string)=>auxiliaryKeys.has(key)||key.startsWith('armi_cloud_sync_')||key.startsWith('armi_view_selection_')||key.endsWith('_view_selection')||key.endsWith('_theme');
export const needsAcademicViewRefresh=(before:Record<string,string>,after:Record<string,string>)=>
  Object.keys({...before,...after}).some(key=>!auxiliary(key)&&before[key]!==after[key]);
