export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      categories: {
        Row: {
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      order_items: {
        Row: {
          id: string
          order_id: string
          product_id: string
          product_name: string
          quantity: number
          selections: Json
          spec_summary: string
          unit_price: number
        }
        Insert: {
          id?: string
          order_id: string
          product_id: string
          product_name: string
          quantity: number
          selections?: Json
          spec_summary: string
          unit_price: number
        }
        Update: {
          id?: string
          order_id?: string
          product_id?: string
          product_name?: string
          quantity?: number
          selections?: Json
          spec_summary?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          completed_at: string | null
          created_at: string
          dining_mode: Database["public"]["Enums"]["dining_mode"]
          id: string
          idempotency_key: string
          notes: string
          order_number: string
          packaging_fee: number
          pickup_code: string
          pickup_code_date: string
          ready_at: string
          status: Database["public"]["Enums"]["order_status"]
          store_address: string
          store_id: string
          store_name: string
          store_phone: string
          total_amount: number
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          dining_mode: Database["public"]["Enums"]["dining_mode"]
          id?: string
          idempotency_key: string
          notes?: string
          order_number: string
          packaging_fee: number
          pickup_code: string
          pickup_code_date: string
          ready_at: string
          status?: Database["public"]["Enums"]["order_status"]
          store_address: string
          store_id: string
          store_name: string
          store_phone: string
          total_amount: number
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          dining_mode?: Database["public"]["Enums"]["dining_mode"]
          id?: string
          idempotency_key?: string
          notes?: string
          order_number?: string
          packaging_fee?: number
          pickup_code?: string
          pickup_code_date?: string
          ready_at?: string
          status?: Database["public"]["Enums"]["order_status"]
          store_address?: string
          store_id?: string
          store_name?: string
          store_phone?: string
          total_amount?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      pickup_code_counters: {
        Row: {
          counter: number
          local_date: string
          store_id: string
        }
        Insert: {
          counter: number
          local_date: string
          store_id: string
        }
        Update: {
          counter?: number
          local_date?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pickup_code_counters_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      product_spec_groups: {
        Row: {
          group_id: string
          product_id: string
          sort_order: number
        }
        Insert: {
          group_id: string
          product_id: string
          sort_order?: number
        }
        Update: {
          group_id?: string
          product_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_spec_groups_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "spec_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_spec_groups_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          availability: Database["public"]["Enums"]["product_availability"]
          category_id: string
          description: string
          id: string
          image_path: string | null
          name: string
          price: number
          sales: number
          sort_order: number
          tags: string[]
        }
        Insert: {
          availability?: Database["public"]["Enums"]["product_availability"]
          category_id: string
          description?: string
          id?: string
          image_path?: string | null
          name: string
          price: number
          sales?: number
          sort_order?: number
          tags?: string[]
        }
        Update: {
          availability?: Database["public"]["Enums"]["product_availability"]
          category_id?: string
          description?: string
          id?: string
          image_path?: string | null
          name?: string
          price?: number
          sales?: number
          sort_order?: number
          tags?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "menu"
            referencedColumns: ["id"]
          },
        ]
      }
      spec_groups: {
        Row: {
          id: string
          multi: boolean
          title: string
        }
        Insert: {
          id?: string
          multi?: boolean
          title: string
        }
        Update: {
          id?: string
          multi?: boolean
          title?: string
        }
        Relationships: []
      }
      spec_options: {
        Row: {
          group_id: string
          id: string
          label: string
          price_extra: number
          sort_order: number
        }
        Insert: {
          group_id: string
          id?: string
          label: string
          price_extra?: number
          sort_order?: number
        }
        Update: {
          group_id?: string
          id?: string
          label?: string
          price_extra?: number
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "spec_options_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "spec_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          address: string
          id: string
          name: string
          phone: string
          ready_delay_seconds: number
          takeout_packaging_fee: number
          timezone: string
          urge_lead_seconds: number
        }
        Insert: {
          address: string
          id?: string
          name: string
          phone: string
          ready_delay_seconds?: number
          takeout_packaging_fee?: number
          timezone: string
          urge_lead_seconds?: number
        }
        Update: {
          address?: string
          id?: string
          name?: string
          phone?: string
          ready_delay_seconds?: number
          takeout_packaging_fee?: number
          timezone?: string
          urge_lead_seconds?: number
        }
        Relationships: []
      }
      wechat_identities: {
        Row: {
          created_at: string
          last_login_at: string
          openid: string
          user_id: string
        }
        Insert: {
          created_at?: string
          last_login_at?: string
          openid: string
          user_id: string
        }
        Update: {
          created_at?: string
          last_login_at?: string
          openid?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      menu: {
        Row: {
          id: string | null
          name: string | null
          products: Json | null
        }
        Relationships: []
      }
    }
    Functions: {
      advance_due_orders: { Args: { p_user_id?: string }; Returns: number }
      allocate_pickup_code: {
        Args: { p_local_date: string; p_store_id: string }
        Returns: string
      }
      build_spec_summary: { Args: { p_labels: string[] }; Returns: string }
      calculate_line_amount: {
        Args: { p_quantity: number; p_unit_price: number }
        Returns: number
      }
      calculate_order_total: {
        Args: {
          p_dining_mode: Database["public"]["Enums"]["dining_mode"]
          p_line_amounts: number[]
          p_takeout_fee: number
        }
        Returns: number
      }
      calculate_packaging_fee: {
        Args: {
          p_dining_mode: Database["public"]["Enums"]["dining_mode"]
          p_takeout_fee: number
        }
        Returns: number
      }
      calculate_unit_price: {
        Args: { p_base_price: number; p_price_extras: number[] }
        Returns: number
      }
      create_order: {
        Args: {
          p_dining_mode: Database["public"]["Enums"]["dining_mode"]
          p_idempotency_key: string
          p_items: Json
          p_notes: string
        }
        Returns: Json
      }
      find_user_by_email: { Args: { p_email: string }; Returns: string }
      order_result_json: {
        Args: {
          p_order: Database["public"]["Tables"]["orders"]["Row"]
          p_timezone: string
        }
        Returns: Json
      }
      pickup_code_from_counter: { Args: { p_counter: number }; Returns: string }
      record_wechat_login: {
        Args: { p_openid: string; p_user_id: string }
        Returns: string
      }
      transition_order: {
        Args: {
          p_from: Database["public"]["Enums"]["order_status"]
          p_order_id: string
          p_to: Database["public"]["Enums"]["order_status"]
          p_user_id?: string
        }
        Returns: {
          completed_at: string | null
          created_at: string
          dining_mode: Database["public"]["Enums"]["dining_mode"]
          id: string
          idempotency_key: string
          notes: string
          order_number: string
          packaging_fee: number
          pickup_code: string
          pickup_code_date: string
          ready_at: string
          status: Database["public"]["Enums"]["order_status"]
          store_address: string
          store_id: string
          store_name: string
          store_phone: string
          total_amount: number
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      urge_order: { Args: { p_order_id: string }; Returns: Json }
    }
    Enums: {
      dining_mode: "dinein" | "takeout"
      login_error_code:
        | "invalid_app_id"
        | "invalid_app_secret"
        | "invalid_code"
        | "code_expired_or_used"
        | "invalid_request"
        | "risky_user_blocked"
        | "rate_limited"
        | "wechat_unavailable"
        | "unknown"
        | "network_unreachable"
        | "identity_failed"
        | "session_failed"
      order_error_code:
        | "invalid_request"
        | "invalid_quantity"
        | "invalid_selection"
        | "product_unavailable"
        | "not_authenticated"
        | "store_unavailable"
        | "invalid_transition"
        | "order_not_found"
        | "invalid_status"
      order_status: "cooking" | "pickup" | "completed"
      product_availability: "on_sale" | "sold_out" | "delisted"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      dining_mode: ["dinein", "takeout"],
      login_error_code: [
        "invalid_app_id",
        "invalid_app_secret",
        "invalid_code",
        "code_expired_or_used",
        "invalid_request",
        "risky_user_blocked",
        "rate_limited",
        "wechat_unavailable",
        "unknown",
        "network_unreachable",
        "identity_failed",
        "session_failed",
      ],
      order_error_code: [
        "invalid_request",
        "invalid_quantity",
        "invalid_selection",
        "product_unavailable",
        "not_authenticated",
        "store_unavailable",
        "invalid_transition",
        "order_not_found",
        "invalid_status",
      ],
      order_status: ["cooking", "pickup", "completed"],
      product_availability: ["on_sale", "sold_out", "delisted"],
    },
  },
} as const

