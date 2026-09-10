<?php

if (!defined('ABSPATH')) {
    exit;
}

class AI_Persona
{
    private static ?AI_Persona $instance = null;

    public static function instance(): self
    {
        if (null === self::$instance) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct()
    {
        add_action('init', [$this, 'register_shortcode']);
        add_action('wp_enqueue_scripts', [$this, 'enqueue_frontend_assets']);
        add_action('admin_enqueue_scripts', [$this, 'enqueue_admin_assets']);
        add_action('rest_api_init', [$this, 'register_rest_routes']);

        // Load settings and widget classes.
        new AI_Persona_Settings();
        new AI_Persona_Widget();
    }

    public static function activate(): void
    {
        // Default options.
        if (false === get_option('ai_persona_settings')) {
            add_option('ai_persona_settings', [
                'api_key'      => '',
                'avatar_id'    => '',
                'voice_id'     => '',
                'language'     => 'en',
                'personality'  => '',
                'greeting'     => 'Hi! How can I help you today?',
                'enable_voice' => true,
                'theme'        => 'dark',
            ]);
        }
    }

    public function register_shortcode(): void
    {
        add_shortcode('ai_persona', [$this, 'render_shortcode']);
    }

    public function render_shortcode(array $atts): string
    {
        $settings = $this->get_settings();
        $widget_id = 'ai-persona-widget-' . wp_unique_id();

        $config = [
            'widgetId'    => $widget_id,
            'apiKey'      => $settings['api_key'],
            'avatarId'    => $settings['avatar_id'],
            'voiceId'     => $settings['voice_id'],
            'language'    => $settings['language'],
            'personality' => $settings['personality'],
            'greeting'    => $settings['greeting'],
            'enableVoice' => (bool) $settings['enable_voice'],
            'theme'       => $settings['theme'],
            'apiBase'     => $this->get_api_base(),
        ];

        wp_enqueue_script('ai-persona-widget');
        wp_localize_script('ai-persona-widget', 'aiPersonaConfig', $config);

        return sprintf(
            '<div id="%s" class="ai-persona-widget" data-theme="%s"></div>',
            esc_attr($widget_id),
            esc_attr($settings['theme'])
        );
    }

    public function enqueue_frontend_assets(): void
    {
        wp_register_style(
            'ai-persona-widget',
            AI_PERSONA_PLUGIN_URL . 'assets/css/widget.css',
            [],
            AI_PERSONA_VERSION
        );
        wp_register_script(
            'ai-persona-widget',
            AI_PERSONA_PLUGIN_URL . 'assets/js/widget.js',
            [],
            AI_PERSONA_VERSION,
            true
        );
    }

    public function enqueue_admin_assets(string $hook): void
    {
        if (false === strpos($hook, 'ai-persona')) {
            return;
        }
        wp_enqueue_style(
            'ai-persona-admin',
            AI_PERSONA_PLUGIN_URL . 'assets/css/admin.css',
            [],
            AI_PERSONA_VERSION
        );
        wp_enqueue_script(
            'ai-persona-admin',
            AI_PERSONA_PLUGIN_URL . 'assets/js/admin.js',
            ['wp-api-fetch'],
            AI_PERSONA_VERSION,
            true
        );
    }

    public function register_rest_routes(): void
    {
        register_rest_route('ai-persona/v1', '/widget/config', [
            'methods'             => 'GET',
            'callback'            => [$this, 'rest_widget_config'],
            'permission_callback' => '__return_true',
        ]);
    }

    public function rest_widget_config(): WP_REST_Response
    {
        $settings = $this->get_settings();
        return new WP_REST_Response([
            'avatarId'    => $settings['avatar_id'],
            'voiceId'     => $settings['voice_id'],
            'language'    => $settings['language'],
            'personality' => $settings['personality'],
            'greeting'    => $settings['greeting'],
            'enableVoice' => (bool) $settings['enable_voice'],
            'theme'       => $settings['theme'],
            'apiBase'     => $this->get_api_base(),
        ]);
    }

    private function get_settings(): array
    {
        $defaults = [
            'api_key'      => '',
            'avatar_id'    => '',
            'voice_id'     => '',
            'language'     => 'en',
            'personality'  => '',
            'greeting'     => 'Hi! How can I help you today?',
            'enable_voice' => true,
            'theme'        => 'dark',
        ];
        return wp_parse_args(get_option('ai_persona_settings', []), $defaults);
    }

    private function get_api_base(): string
    {
        $settings = $this->get_settings();
        return !empty($settings['api_key'])
            ? 'https://api.ai-platform.local'
            : '';
    }
}
