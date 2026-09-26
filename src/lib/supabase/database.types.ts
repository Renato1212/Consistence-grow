
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "action_items": {
                  Row: {
                    "closed_at": string | null,"created_at": string,"deleted_at": string | null,"due_date": string | null,"id": string,"show_in_prep": boolean,"source": string,"source_id": string | null,"status": string,"text": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "closed_at"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"due_date"?: string | null,"id"?: string,"show_in_prep"?: boolean,"source"?: string,"source_id"?: string | null,"status"?: string,"text": string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "closed_at"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"due_date"?: string | null,"id"?: string,"show_in_prep"?: boolean,"source"?: string,"source_id"?: string | null,"status"?: string,"text"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"ai_insights": {
                  Row: {
                    "cost_estimate": number | null,"created_at": string,"data_hash": string,"deleted_at": string | null,"filter": NonNullable<Json>,"id": string,"input_tokens": number | null,"model": string,"output": NonNullable<Json>,"output_tokens": number | null,"scope": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "cost_estimate"?: number | null,"created_at"?: string,"data_hash": string,"deleted_at"?: string | null,"filter"?: NonNullable<Json>,"id"?: string,"input_tokens"?: number | null,"model": string,"output": NonNullable<Json>,"output_tokens"?: number | null,"scope": string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "cost_estimate"?: number | null,"created_at"?: string,"data_hash"?: string,"deleted_at"?: string | null,"filter"?: NonNullable<Json>,"id"?: string,"input_tokens"?: number | null,"model"?: string,"output"?: NonNullable<Json>,"output_tokens"?: number | null,"scope"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"calendar_events": {
                  Row: {
                    "actual": string | null,"category": string,"created_at": string,"deleted_at": string | null,"forecast": string | null,"generator_key": string | null,"id": string,"importance": number,"instruments": (string)[],"native_tz": string,"notes": string | null,"previous": string | null,"primary_domain": string,"secondary_domains": (string)[],"source": string,"starts_at": string,"title": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "actual"?: string | null,"category": string,"created_at"?: string,"deleted_at"?: string | null,"forecast"?: string | null,"generator_key"?: string | null,"id"?: string,"importance"?: number,"instruments"?: (string)[],"native_tz"?: string,"notes"?: string | null,"previous"?: string | null,"primary_domain": string,"secondary_domains"?: (string)[],"source"?: string,"starts_at": string,"title": string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "actual"?: string | null,"category"?: string,"created_at"?: string,"deleted_at"?: string | null,"forecast"?: string | null,"generator_key"?: string | null,"id"?: string,"importance"?: number,"instruments"?: (string)[],"native_tz"?: string,"notes"?: string | null,"previous"?: string | null,"primary_domain"?: string,"secondary_domains"?: (string)[],"source"?: string,"starts_at"?: string,"title"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"debriefs": {
                  Row: {
                    "completed_at": string | null,"created_at": string,"day_id": string,"deleted_at": string | null,"energy": number | null,"grade_context": string | null,"grade_context_note": string | null,"grade_edge": string | null,"grade_edge_note": string | null,"grade_process": string | null,"grade_process_note": string | null,"id": string,"lesson": string | null,"mood": number | null,"to_improve": (string)[],"updated_at": string,"user_id": string,"went_well": (string)[]
                  }
                  Insert: {
                    "completed_at"?: string | null,"created_at"?: string,"day_id": string,"deleted_at"?: string | null,"energy"?: number | null,"grade_context"?: string | null,"grade_context_note"?: string | null,"grade_edge"?: string | null,"grade_edge_note"?: string | null,"grade_process"?: string | null,"grade_process_note"?: string | null,"id"?: string,"lesson"?: string | null,"mood"?: number | null,"to_improve"?: (string)[],"updated_at"?: string,"user_id"?: string,"went_well"?: (string)[]
                  }
                  Update: {
                    "completed_at"?: string | null,"created_at"?: string,"day_id"?: string,"deleted_at"?: string | null,"energy"?: number | null,"grade_context"?: string | null,"grade_context_note"?: string | null,"grade_edge"?: string | null,"grade_edge_note"?: string | null,"grade_process"?: string | null,"grade_process_note"?: string | null,"id"?: string,"lesson"?: string | null,"mood"?: number | null,"to_improve"?: (string)[],"updated_at"?: string,"user_id"?: string,"went_well"?: (string)[]
                  }
                  Relationships: [
                    {
      foreignKeyName: "debriefs_day_id_fkey"
      columns: ["day_id"]
isOneToOne: true
      referencedRelation: "trading_days"
      referencedColumns: ["id"]
    }
                  ]
                },"error_logs": {
                  Row: {
                    "context": NonNullable<Json>,"created_at": string,"id": string,"level": string,"message": string,"source": string,"user_id": string | null
                  }
                  Insert: {
                    "context"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"level"?: string,"message": string,"source": string,"user_id"?: string | null
                  }
                  Update: {
                    "context"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"level"?: string,"message"?: string,"source"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"fills": {
                  Row: {
                    "account": string | null,"created_at": string,"deleted_at": string | null,"executed_at": string,"hash": string,"id": string,"price": number,"qty": number,"raw": NonNullable<Json>,"side": string,"symbol": string,"trade_id": string | null,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "account"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"executed_at": string,"hash": string,"id"?: string,"price": number,"qty": number,"raw"?: NonNullable<Json>,"side": string,"symbol": string,"trade_id"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "account"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"executed_at"?: string,"hash"?: string,"id"?: string,"price"?: number,"qty"?: number,"raw"?: NonNullable<Json>,"side"?: string,"symbol"?: string,"trade_id"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "fills_trade_id_fkey"
      columns: ["trade_id"]
isOneToOne: false
      referencedRelation: "trade_facts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fills_trade_id_fkey"
      columns: ["trade_id"]
isOneToOne: false
      referencedRelation: "trades"
      referencedColumns: ["id"]
    }
                  ]
                },"import_presets": {
                  Row: {
                    "created_at": string,"deleted_at": string | null,"id": string,"mapping": NonNullable<Json>,"name": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"deleted_at"?: string | null,"id"?: string,"mapping"?: NonNullable<Json>,"name": string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"deleted_at"?: string | null,"id"?: string,"mapping"?: NonNullable<Json>,"name"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"instruments": {
                  Row: {
                    "active": boolean,"asset_class": string,"created_at": string,"currency": string,"deleted_at": string | null,"exchange": string,"exchange_tz": string,"fee_per_contract": number,"id": string,"name": string,"notes": string | null,"price_format": string,"sort_order": number,"symbol": string,"tick_size": number,"tick_value": number,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "active"?: boolean,"asset_class": string,"created_at"?: string,"currency"?: string,"deleted_at"?: string | null,"exchange": string,"exchange_tz"?: string,"fee_per_contract"?: number,"id"?: string,"name": string,"notes"?: string | null,"price_format"?: string,"sort_order"?: number,"symbol": string,"tick_size": number,"tick_value": number,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "active"?: boolean,"asset_class"?: string,"created_at"?: string,"currency"?: string,"deleted_at"?: string | null,"exchange"?: string,"exchange_tz"?: string,"fee_per_contract"?: number,"id"?: string,"name"?: string,"notes"?: string | null,"price_format"?: string,"sort_order"?: number,"symbol"?: string,"tick_size"?: number,"tick_value"?: number,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"key_levels": {
                  Row: {
                    "carried_from_id": string | null,"created_at": string,"deleted_at": string | null,"id": string,"instrument_id": string,"level_type": string,"note": string | null,"prep_id": string,"price_high": number | null,"price_low": number,"respected": boolean | null,"sort": number,"strength": number,"tested": boolean | null,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "carried_from_id"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"instrument_id": string,"level_type": string,"note"?: string | null,"prep_id": string,"price_high"?: number | null,"price_low": number,"respected"?: boolean | null,"sort"?: number,"strength"?: number,"tested"?: boolean | null,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "carried_from_id"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"instrument_id"?: string,"level_type"?: string,"note"?: string | null,"prep_id"?: string,"price_high"?: number | null,"price_low"?: number,"respected"?: boolean | null,"sort"?: number,"strength"?: number,"tested"?: boolean | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "key_levels_carried_from_id_fkey"
      columns: ["carried_from_id"]
isOneToOne: false
      referencedRelation: "key_levels"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "key_levels_instrument_id_fkey"
      columns: ["instrument_id"]
isOneToOne: false
      referencedRelation: "instruments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "key_levels_prep_id_fkey"
      columns: ["prep_id"]
isOneToOne: false
      referencedRelation: "session_preps"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "key_levels_prep_id_fkey"
      columns: ["prep_id"]
isOneToOne: false
      referencedRelation: "trade_facts"
      referencedColumns: ["prep_id"]
    }
                  ]
                },"media": {
                  Row: {
                    "caption": string | null,"created_at": string,"deleted_at": string | null,"duration_sec": number | null,"height": number | null,"id": string,"kind": string,"mime": string | null,"owner_id": string,"owner_type": string,"size_bytes": number | null,"sort": number,"storage_path": string | null,"thumb_path": string | null,"updated_at": string,"url": string | null,"user_id": string,"width": number | null
                  }
                  Insert: {
                    "caption"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"duration_sec"?: number | null,"height"?: number | null,"id"?: string,"kind": string,"mime"?: string | null,"owner_id": string,"owner_type": string,"size_bytes"?: number | null,"sort"?: number,"storage_path"?: string | null,"thumb_path"?: string | null,"updated_at"?: string,"url"?: string | null,"user_id"?: string,"width"?: number | null
                  }
                  Update: {
                    "caption"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"duration_sec"?: number | null,"height"?: number | null,"id"?: string,"kind"?: string,"mime"?: string | null,"owner_id"?: string,"owner_type"?: string,"size_bytes"?: number | null,"sort"?: number,"storage_path"?: string | null,"thumb_path"?: string | null,"updated_at"?: string,"url"?: string | null,"user_id"?: string,"width"?: number | null
                  }
                  Relationships: [
                    
                  ]
                },"playbook_checklist_items": {
                  Row: {
                    "created_at": string,"deleted_at": string | null,"id": string,"playbook_id": string,"sort": number,"text": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"deleted_at"?: string | null,"id"?: string,"playbook_id": string,"sort"?: number,"text": string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"deleted_at"?: string | null,"id"?: string,"playbook_id"?: string,"sort"?: number,"text"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "playbook_checklist_items_playbook_id_fkey"
      columns: ["playbook_id"]
isOneToOne: false
      referencedRelation: "playbooks"
      referencedColumns: ["id"]
    }
                  ]
                },"playbook_versions": {
                  Row: {
                    "created_at": string,"deleted_at": string | null,"id": string,"playbook_id": string,"snapshot": NonNullable<Json>,"updated_at": string,"user_id": string,"version": number
                  }
                  Insert: {
                    "created_at"?: string,"deleted_at"?: string | null,"id"?: string,"playbook_id": string,"snapshot": NonNullable<Json>,"updated_at"?: string,"user_id"?: string,"version": number
                  }
                  Update: {
                    "created_at"?: string,"deleted_at"?: string | null,"id"?: string,"playbook_id"?: string,"snapshot"?: NonNullable<Json>,"updated_at"?: string,"user_id"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "playbook_versions_playbook_id_fkey"
      columns: ["playbook_id"]
isOneToOne: false
      referencedRelation: "playbooks"
      referencedColumns: ["id"]
    }
                  ]
                },"playbooks": {
                  Row: {
                    "avoid_md": string | null,"context_md": string | null,"created_at": string,"deleted_at": string | null,"edge_md": string | null,"id": string,"markets": (string)[],"name": string,"notes_json": Json | null,"primary_domain": string,"secondary_domains": (string)[],"status": string,"stop_md": string | null,"summary": string | null,"targets_md": string | null,"trigger_md": string | null,"updated_at": string,"user_id": string,"version": number
                  }
                  Insert: {
                    "avoid_md"?: string | null,"context_md"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"edge_md"?: string | null,"id"?: string,"markets"?: (string)[],"name": string,"notes_json"?: Json | null,"primary_domain": string,"secondary_domains"?: (string)[],"status"?: string,"stop_md"?: string | null,"summary"?: string | null,"targets_md"?: string | null,"trigger_md"?: string | null,"updated_at"?: string,"user_id"?: string,"version"?: number
                  }
                  Update: {
                    "avoid_md"?: string | null,"context_md"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"edge_md"?: string | null,"id"?: string,"markets"?: (string)[],"name"?: string,"notes_json"?: Json | null,"primary_domain"?: string,"secondary_domains"?: (string)[],"status"?: string,"stop_md"?: string | null,"summary"?: string | null,"targets_md"?: string | null,"trigger_md"?: string | null,"updated_at"?: string,"user_id"?: string,"version"?: number
                  }
                  Relationships: [
                    
                  ]
                },"rule_checks": {
                  Row: {
                    "context": string,"created_at": string,"day_id": string,"deleted_at": string | null,"followed": boolean | null,"id": string,"note": string | null,"prep_id": string | null,"rule_id": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "context": string,"created_at"?: string,"day_id": string,"deleted_at"?: string | null,"followed"?: boolean | null,"id"?: string,"note"?: string | null,"prep_id"?: string | null,"rule_id": string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "context"?: string,"created_at"?: string,"day_id"?: string,"deleted_at"?: string | null,"followed"?: boolean | null,"id"?: string,"note"?: string | null,"prep_id"?: string | null,"rule_id"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "rule_checks_day_id_fkey"
      columns: ["day_id"]
isOneToOne: false
      referencedRelation: "trading_days"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rule_checks_prep_id_fkey"
      columns: ["prep_id"]
isOneToOne: false
      referencedRelation: "session_preps"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rule_checks_prep_id_fkey"
      columns: ["prep_id"]
isOneToOne: false
      referencedRelation: "trade_facts"
      referencedColumns: ["prep_id"]
    },{
      foreignKeyName: "rule_checks_rule_id_fkey"
      columns: ["rule_id"]
isOneToOne: false
      referencedRelation: "rules"
      referencedColumns: ["id"]
    }
                  ]
                },"rules": {
                  Row: {
                    "active": boolean,"category": string,"created_at": string,"deleted_at": string | null,"id": string,"sort": number,"text": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "active"?: boolean,"category"?: string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"sort"?: number,"text": string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "active"?: boolean,"category"?: string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"sort"?: number,"text"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"saved_views": {
                  Row: {
                    "created_at": string,"deleted_at": string | null,"filter": NonNullable<Json>,"id": string,"name": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"deleted_at"?: string | null,"filter"?: NonNullable<Json>,"id"?: string,"name": string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"deleted_at"?: string | null,"filter"?: NonNullable<Json>,"id"?: string,"name"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"scenarios": {
                  Row: {
                    "created_at": string,"deleted_at": string | null,"direction": string | null,"id": string,"if_text": string,"instrument_id": string | null,"outcome": string | null,"playbook_id": string | null,"prep_id": string,"primary_domain": string | null,"sort": number,"then_text": string,"traded": boolean | null,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"deleted_at"?: string | null,"direction"?: string | null,"id"?: string,"if_text"?: string,"instrument_id"?: string | null,"outcome"?: string | null,"playbook_id"?: string | null,"prep_id": string,"primary_domain"?: string | null,"sort"?: number,"then_text"?: string,"traded"?: boolean | null,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"deleted_at"?: string | null,"direction"?: string | null,"id"?: string,"if_text"?: string,"instrument_id"?: string | null,"outcome"?: string | null,"playbook_id"?: string | null,"prep_id"?: string,"primary_domain"?: string | null,"sort"?: number,"then_text"?: string,"traded"?: boolean | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "scenarios_instrument_id_fkey"
      columns: ["instrument_id"]
isOneToOne: false
      referencedRelation: "instruments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "scenarios_playbook_id_fkey"
      columns: ["playbook_id"]
isOneToOne: false
      referencedRelation: "playbooks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "scenarios_prep_id_fkey"
      columns: ["prep_id"]
isOneToOne: false
      referencedRelation: "session_preps"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "scenarios_prep_id_fkey"
      columns: ["prep_id"]
isOneToOne: false
      referencedRelation: "trade_facts"
      referencedColumns: ["prep_id"]
    }
                  ]
                },"session_preps": {
                  Row: {
                    "brief_md": string | null,"completed_at": string | null,"copied_from_id": string | null,"created_at": string,"day_id": string,"deleted_at": string | null,"energy": number | null,"focus": number | null,"focus_instrument_ids": (string)[],"focus_playbook_ids": (string)[],"how_am_i": string | null,"id": string,"intention": string | null,"max_loss_r": number | null,"max_loss_usd": number | null,"max_size": number | null,"max_trades": number | null,"narrative": string | null,"options_notes": string | null,"prior_day_type": string | null,"regime": string | null,"session": string,"sleep": number | null,"started_at": string,"updated_at": string,"user_id": string,"vol_state": string | null
                  }
                  Insert: {
                    "brief_md"?: string | null,"completed_at"?: string | null,"copied_from_id"?: string | null,"created_at"?: string,"day_id": string,"deleted_at"?: string | null,"energy"?: number | null,"focus"?: number | null,"focus_instrument_ids"?: (string)[],"focus_playbook_ids"?: (string)[],"how_am_i"?: string | null,"id"?: string,"intention"?: string | null,"max_loss_r"?: number | null,"max_loss_usd"?: number | null,"max_size"?: number | null,"max_trades"?: number | null,"narrative"?: string | null,"options_notes"?: string | null,"prior_day_type"?: string | null,"regime"?: string | null,"session": string,"sleep"?: number | null,"started_at"?: string,"updated_at"?: string,"user_id"?: string,"vol_state"?: string | null
                  }
                  Update: {
                    "brief_md"?: string | null,"completed_at"?: string | null,"copied_from_id"?: string | null,"created_at"?: string,"day_id"?: string,"deleted_at"?: string | null,"energy"?: number | null,"focus"?: number | null,"focus_instrument_ids"?: (string)[],"focus_playbook_ids"?: (string)[],"how_am_i"?: string | null,"id"?: string,"intention"?: string | null,"max_loss_r"?: number | null,"max_loss_usd"?: number | null,"max_size"?: number | null,"max_trades"?: number | null,"narrative"?: string | null,"options_notes"?: string | null,"prior_day_type"?: string | null,"regime"?: string | null,"session"?: string,"sleep"?: number | null,"started_at"?: string,"updated_at"?: string,"user_id"?: string,"vol_state"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "session_preps_copied_from_id_fkey"
      columns: ["copied_from_id"]
isOneToOne: false
      referencedRelation: "session_preps"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "session_preps_copied_from_id_fkey"
      columns: ["copied_from_id"]
isOneToOne: false
      referencedRelation: "trade_facts"
      referencedColumns: ["prep_id"]
    },{
      foreignKeyName: "session_preps_day_id_fkey"
      columns: ["day_id"]
isOneToOne: false
      referencedRelation: "trading_days"
      referencedColumns: ["id"]
    }
                  ]
                },"tag_groups": {
                  Row: {
                    "color": string | null,"created_at": string,"deleted_at": string | null,"id": string,"kind": string,"name": string,"sort": number,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "color"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"kind"?: string,"name": string,"sort"?: number,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "color"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"kind"?: string,"name"?: string,"sort"?: number,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"tags": {
                  Row: {
                    "color": string | null,"created_at": string,"deleted_at": string | null,"group_id": string,"id": string,"name": string,"sort": number,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "color"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"group_id": string,"id"?: string,"name": string,"sort"?: number,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "color"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"group_id"?: string,"id"?: string,"name"?: string,"sort"?: number,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tags_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "tag_groups"
      referencedColumns: ["id"]
    }
                  ]
                },"trade_tags": {
                  Row: {
                    "created_at": string,"tag_id": string,"trade_id": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"tag_id": string,"trade_id": string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"tag_id"?: string,"trade_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "trade_tags_tag_id_fkey"
      columns: ["tag_id"]
isOneToOne: false
      referencedRelation: "tags"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trade_tags_trade_id_fkey"
      columns: ["trade_id"]
isOneToOne: false
      referencedRelation: "trade_facts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trade_tags_trade_id_fkey"
      columns: ["trade_id"]
isOneToOne: false
      referencedRelation: "trades"
      referencedColumns: ["id"]
    }
                  ]
                },"trades": {
                  Row: {
                    "calendar_event_id": string | null,"confidence": number | null,"contracts": number | null,"created_at": string,"day_id": string | null,"deleted_at": string | null,"direction": string,"duration_sec": number | null,"entry_at": string,"entry_price": number,"entry_type": string | null,"exit_at": string | null,"exit_price": number | null,"exit_reason": string | null,"fees": number | null,"fees_total": number | null,"grade_context": string | null,"grade_context_reason": string | null,"grade_edge": string | null,"grade_edge_reason": string | null,"grade_process": string | null,"grade_process_reason": string | null,"gross_pnl": number | null,"id": string,"import_hash": string | null,"instrument_id": string,"key_level_id": string | null,"kind": string,"lesson": string | null,"mae_ticks": number | null,"management": string | null,"mfe_ticks": number | null,"minutes_from_event": number | null,"move_phases": string | null,"move_trigger": string | null,"needs_review": boolean,"net_pnl": number | null,"no_stop": boolean,"planned_r": number | null,"playbook_id": string | null,"playbook_version": number | null,"primary_domain": string | null,"r_multiple": number | null,"risk_usd": number | null,"scenario_id": string | null,"secondary_domains": (string)[],"session": string | null,"stop_price": number | null,"target_price": number | null,"thesis": string | null,"ticks": number | null,"time_bucket": string | null,"updated_at": string,"user_id": string,"weekday": number | null
                  }
                  Insert: {
                    "calendar_event_id"?: string | null,"confidence"?: number | null,"contracts"?: number | null,"created_at"?: string,"day_id"?: string | null,"deleted_at"?: string | null,"direction": string,"duration_sec"?: number | null,"entry_at": string,"entry_price": number,"entry_type"?: string | null,"exit_at"?: string | null,"exit_price"?: number | null,"exit_reason"?: string | null,"fees"?: number | null,"fees_total"?: number | null,"grade_context"?: string | null,"grade_context_reason"?: string | null,"grade_edge"?: string | null,"grade_edge_reason"?: string | null,"grade_process"?: string | null,"grade_process_reason"?: string | null,"gross_pnl"?: number | null,"id"?: string,"import_hash"?: string | null,"instrument_id": string,"key_level_id"?: string | null,"kind"?: string,"lesson"?: string | null,"mae_ticks"?: number | null,"management"?: string | null,"mfe_ticks"?: number | null,"minutes_from_event"?: number | null,"move_phases"?: string | null,"move_trigger"?: string | null,"needs_review"?: boolean,"net_pnl"?: number | null,"no_stop"?: boolean,"planned_r"?: number | null,"playbook_id"?: string | null,"playbook_version"?: number | null,"primary_domain"?: string | null,"r_multiple"?: number | null,"risk_usd"?: number | null,"scenario_id"?: string | null,"secondary_domains"?: (string)[],"session"?: string | null,"stop_price"?: number | null,"target_price"?: number | null,"thesis"?: string | null,"ticks"?: number | null,"time_bucket"?: string | null,"updated_at"?: string,"user_id"?: string,"weekday"?: number | null
                  }
                  Update: {
                    "calendar_event_id"?: string | null,"confidence"?: number | null,"contracts"?: number | null,"created_at"?: string,"day_id"?: string | null,"deleted_at"?: string | null,"direction"?: string,"duration_sec"?: number | null,"entry_at"?: string,"entry_price"?: number,"entry_type"?: string | null,"exit_at"?: string | null,"exit_price"?: number | null,"exit_reason"?: string | null,"fees"?: number | null,"fees_total"?: number | null,"grade_context"?: string | null,"grade_context_reason"?: string | null,"grade_edge"?: string | null,"grade_edge_reason"?: string | null,"grade_process"?: string | null,"grade_process_reason"?: string | null,"gross_pnl"?: number | null,"id"?: string,"import_hash"?: string | null,"instrument_id"?: string,"key_level_id"?: string | null,"kind"?: string,"lesson"?: string | null,"mae_ticks"?: number | null,"management"?: string | null,"mfe_ticks"?: number | null,"minutes_from_event"?: number | null,"move_phases"?: string | null,"move_trigger"?: string | null,"needs_review"?: boolean,"net_pnl"?: number | null,"no_stop"?: boolean,"planned_r"?: number | null,"playbook_id"?: string | null,"playbook_version"?: number | null,"primary_domain"?: string | null,"r_multiple"?: number | null,"risk_usd"?: number | null,"scenario_id"?: string | null,"secondary_domains"?: (string)[],"session"?: string | null,"stop_price"?: number | null,"target_price"?: number | null,"thesis"?: string | null,"ticks"?: number | null,"time_bucket"?: string | null,"updated_at"?: string,"user_id"?: string,"weekday"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "trades_calendar_event_id_fkey"
      columns: ["calendar_event_id"]
isOneToOne: false
      referencedRelation: "calendar_events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trades_day_id_fkey"
      columns: ["day_id"]
isOneToOne: false
      referencedRelation: "trading_days"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trades_instrument_id_fkey"
      columns: ["instrument_id"]
isOneToOne: false
      referencedRelation: "instruments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trades_key_level_id_fkey"
      columns: ["key_level_id"]
isOneToOne: false
      referencedRelation: "key_levels"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trades_playbook_id_fkey"
      columns: ["playbook_id"]
isOneToOne: false
      referencedRelation: "playbooks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trades_scenario_id_fkey"
      columns: ["scenario_id"]
isOneToOne: false
      referencedRelation: "scenarios"
      referencedColumns: ["id"]
    }
                  ]
                },"trading_days": {
                  Row: {
                    "created_at": string,"date": string,"deleted_at": string | null,"id": string,"status": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"date": string,"deleted_at"?: string | null,"id"?: string,"status"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"date"?: string,"deleted_at"?: string | null,"id"?: string,"status"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"user_settings": {
                  Row: {
                    "created_at": string,"currency_display": string,"deleted_at": string | null,"display_tz": string,"eu_prep_by": string,"eu_prep_tz": string,"eu_session_start": string,"eu_session_tz": string,"event_banner_minutes": number,"id": string,"last_instrument_id": string | null,"pattern_min_n": number,"secondary_tz": string | null,"updated_at": string,"us_cash_open": string,"us_session_end": string,"us_session_start": string,"us_session_tz": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"currency_display"?: string,"deleted_at"?: string | null,"display_tz"?: string,"eu_prep_by"?: string,"eu_prep_tz"?: string,"eu_session_start"?: string,"eu_session_tz"?: string,"event_banner_minutes"?: number,"id"?: string,"last_instrument_id"?: string | null,"pattern_min_n"?: number,"secondary_tz"?: string | null,"updated_at"?: string,"us_cash_open"?: string,"us_session_end"?: string,"us_session_start"?: string,"us_session_tz"?: string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"currency_display"?: string,"deleted_at"?: string | null,"display_tz"?: string,"eu_prep_by"?: string,"eu_prep_tz"?: string,"eu_session_start"?: string,"eu_session_tz"?: string,"event_banner_minutes"?: number,"id"?: string,"last_instrument_id"?: string | null,"pattern_min_n"?: number,"secondary_tz"?: string | null,"updated_at"?: string,"us_cash_open"?: string,"us_session_end"?: string,"us_session_start"?: string,"us_session_tz"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_settings_last_instrument_id_fkey"
      columns: ["last_instrument_id"]
isOneToOne: false
      referencedRelation: "instruments"
      referencedColumns: ["id"]
    }
                  ]
                },"weekly_reviews": {
                  Row: {
                    "created_at": string,"deleted_at": string | null,"goals": (string)[],"id": string,"iso_week": number,"iso_year": number,"reflection": string | null,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"deleted_at"?: string | null,"goals"?: (string)[],"id"?: string,"iso_week": number,"iso_year": number,"reflection"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"deleted_at"?: string | null,"goals"?: (string)[],"id"?: string,"iso_week"?: number,"iso_year"?: number,"reflection"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            "trade_facts": {
                  Row: {
                    "asset_class": string | null,"calendar_event_id": string | null,"confidence": number | null,"contracts": number | null,"created_at": string | null,"currency": string | null,"day_id": string | null,"deleted_at": string | null,"direction": string | null,"domain_count": number | null,"duration_sec": number | null,"entry_at": string | null,"entry_price": number | null,"entry_type": string | null,"event_category": string | null,"event_domain": string | null,"event_importance": number | null,"event_title": string | null,"exchange": string | null,"exit_at": string | null,"exit_price": number | null,"exit_reason": string | null,"fees": number | null,"fees_total": number | null,"grade_context": string | null,"grade_context_reason": string | null,"grade_edge": string | null,"grade_edge_reason": string | null,"grade_process": string | null,"grade_process_reason": string | null,"gross_pnl": number | null,"id": string | null,"import_hash": string | null,"instrument_id": string | null,"is_win": boolean | null,"key_level_id": string | null,"kind": string | null,"lesson": string | null,"level_strength": number | null,"level_type": string | null,"mae_ticks": number | null,"management": string | null,"media_count": number | null,"mfe_ticks": number | null,"minutes_from_event": number | null,"move_phases": string | null,"move_trigger": string | null,"needs_review": boolean | null,"net_pnl": number | null,"no_stop": boolean | null,"planned_r": number | null,"playbook_id": string | null,"playbook_name": string | null,"playbook_status": string | null,"playbook_version": number | null,"prep_done": boolean | null,"prep_id": string | null,"primary_domain": string | null,"prior_day_type": string | null,"r_multiple": number | null,"readiness": number | null,"regime": string | null,"risk_usd": number | null,"scenario_id": string | null,"secondary_domains": (string)[] | null,"session": string | null,"stop_price": number | null,"symbol": string | null,"tag_ids": (string)[] | null,"tag_names": (string)[] | null,"target_price": number | null,"thesis": string | null,"ticks": number | null,"time_bucket": string | null,"trade_date": string | null,"updated_at": string | null,"user_id": string | null,"vol_state": string | null,"weekday": number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "trades_calendar_event_id_fkey"
      columns: ["calendar_event_id"]
isOneToOne: false
      referencedRelation: "calendar_events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trades_day_id_fkey"
      columns: ["day_id"]
isOneToOne: false
      referencedRelation: "trading_days"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trades_instrument_id_fkey"
      columns: ["instrument_id"]
isOneToOne: false
      referencedRelation: "instruments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trades_key_level_id_fkey"
      columns: ["key_level_id"]
isOneToOne: false
      referencedRelation: "key_levels"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trades_playbook_id_fkey"
      columns: ["playbook_id"]
isOneToOne: false
      referencedRelation: "playbooks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trades_scenario_id_fkey"
      columns: ["scenario_id"]
isOneToOne: false
      referencedRelation: "scenarios"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            [_ in never]: never
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const

