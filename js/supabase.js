/**
 * Supabase Configuration
 * Initializes Supabase client for storing statistics and other data
 */

// Supabase configuration
const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

// Initialize Supabase client if the library is loaded
let supabaseClient = null;

if (typeof supabase !== 'undefined') {
    try {
        // Create client with explicit options to avoid 406 errors
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            db: {
                schema: 'public'
            },
            auth: {
                persistSession: false,
                autoRefreshToken: false
            },
            global: {
                headers: {
                    'apikey': SUPABASE_ANON_KEY
                }
            }
        });
        window.supabaseClient = supabaseClient;
        console.log('✅ Supabase client initialized');
    } catch (error) {
        console.error('❌ Error initializing Supabase client:', error);
    }
} else {
    console.warn('⚠️ Supabase library not loaded. Make sure to include the Supabase CDN script before this file.');
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { supabaseClient, SUPABASE_URL, SUPABASE_ANON_KEY };
}

