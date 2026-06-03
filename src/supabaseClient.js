import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://afhzkqjrciyoeizrpaxt.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmaHprcWpyY2l5b2VpenJwYXh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTk1MTcsImV4cCI6MjA5NTk5NTUxN30.TY7bdmAthoQAts_BEfvNMgZirEUmLKjxLCkUP8vkABI'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
