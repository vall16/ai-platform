<?php

if (!defined('ABSPATH')) {
    exit;
}

class AI_Salesperson
{
    private static ?AI_Salesperson $instance = null;

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
        new AI_Salesperson_Settings();
        new AI_Salesperson_Widget();
    }

    public static function activate(): void
    {
        // Default options.
        if (false === get_option('ai_salesperson_settings')) {
            add_option('ai_salesperson_settings', [
                'api_base'        => '',
                'api_key'         => '',
                'shop_name'       => '',
                'currency'        => '',
                'consumer_key'    => '',
                'consumer_secret' => '',
                'language'        => 'en',
                'personality'     => '',
                'greeting'        => "Hi! I'm your shopping assistant. What are you looking for?",
                'enable_voice'    => true,
                'theme'           => 'light',
            ]);
        }
    }

    public function register_shortcode(): void
    {
        add_shortcode('ai_salesperson', [$this, 'render_shortcode']);
    }

    public function render_shortcode(array $atts): string
    {
        $settings  = $this->get_settings();
        $widget_id = 'ai-salesperson-widget-' . wp_unique_id();

        $config = [
            'widgetId'        => $widget_id,
            'apiKey'          => $settings['api_key'],
            'apiBase'         => $this->get_api_base(),
            'shopName'        => $settings['shop_name'] !== '' ? $settings['shop_name'] : get_bloginfo('name'),
            'shopUrl'         => $this->live_shop_url($settings),
            'platform'        => 'woocommerce',
            'currency'        => $this->resolve_currency($settings),
            'shopCredentials' => $this->live_credentials($settings),
            'language'        => $settings['language'],
            'personality'     => $settings['personality'],
            'greeting'        => $settings['greeting'],
            'enableVoice'     => (bool) $settings['enable_voice'],
            'theme'           => $settings['theme'],
        ];

        wp_enqueue_script('ai-salesperson-widget');
        wp_localize_script('ai-salesperson-widget', 'aiSalespersonConfig', $config);

        return sprintf(
            '<div id="%s" class="ai-salesperson-widget" data-theme="%s"></div>',
            esc_attr($widget_id),
            esc_attr($settings['theme'])
        );
    }

    public function enqueue_frontend_assets(): void
    {
        wp_register_style(
            'ai-salesperson-widget',
            AI_SALESPERSON_PLUGIN_URL . 'assets/css/widget.css',
            [],
            AI_SALESPERSON_VERSION
        );
        wp_register_script(
            'ai-salesperson-widget',
            AI_SALESPERSON_PLUGIN_URL . 'assets/js/ai-salesperson.js',
            [],
            AI_SALESPERSON_VERSION,
            true
        );
    }

    public function enqueue_admin_assets(string $hook): void
    {
        if (false === strpos($hook, 'ai-salesperson')) {
            return;
        }
        wp_enqueue_style(
            'ai-salesperson-admin',
            AI_SALESPERSON_PLUGIN_URL . 'assets/css/admin.css',
            [],
            AI_SALESPERSON_VERSION
        );
        wp_enqueue_script(
            'ai-salesperson-admin',
            AI_SALESPERSON_PLUGIN_URL . 'assets/js/admin.js',
            [],
            AI_SALESPERSON_VERSION,
            true
        );
        wp_localize_script(
            'ai-salesperson-admin',
            'aiSalespersonAdmin',
            ['apiBase' => $this->get_api_base()]
        );
    }

    public function register_rest_routes(): void
    {
        register_rest_route('ai-salesperson/v1', '/widget/config', [
            'methods'             => 'GET',
            'callback'            => [$this, 'rest_widget_config'],
            'permission_callback' => '__return_true',
        ]);
    }

    public function rest_widget_config(): WP_REST_Response
    {
        $settings = $this->get_settings();
        return new WP_REST_Response([
            'shopName'      => $settings['shop_name'] !== '' ? $settings['shop_name'] : get_bloginfo('name'),
            'platform'      => 'woocommerce',
            'currency'      => $this->resolve_currency($settings),
            'language'      => $settings['language'],
            'personality'   => $settings['personality'],
            'greeting'      => $settings['greeting'],
            'enableVoice'   => (bool) $settings['enable_voice'],
            'theme'         => $settings['theme'],
            'apiBase'       => $this->get_api_base(),
        ]);
    }

    private function get_settings(): array
    {
        $defaults = [
            'api_base'        => '',
            'api_key'         => '',
            'shop_name'       => '',
            'currency'        => '',
            'consumer_key'    => '',
            'consumer_secret' => '',
            'language'        => 'en',
            'personality'     => '',
            'greeting'        => "Hi! I'm your shopping assistant. What are you looking for?",
            'enable_voice'    => true,
            'theme'           => 'light',
        ];
        return wp_parse_args(get_option('ai_salesperson_settings', []), $defaults);
    }

    private function get_api_base(): string
    {
        $settings = $this->get_settings();
        return rtrim((string) ($settings['api_base'] ?? ''), '/');
    }

    /**
     * Live commerce is only enabled when both WooCommerce REST API credentials
     * are present; otherwise the widget runs in demo mode (mock catalog) by
     * omitting shop_url from the session body.
     */
    private function has_live_credentials(array $settings): bool
    {
        return !empty($settings['consumer_key']) && !empty($settings['consumer_secret']);
    }

    private function live_shop_url(array $settings): string
    {
        return $this->has_live_credentials($settings) ? home_url() : '';
    }

    private function live_credentials(array $settings): ?array
    {
        if (!$this->has_live_credentials($settings)) {
            return null;
        }
        return [
            'consumer_key'    => $settings['consumer_key'],
            'consumer_secret' => $settings['consumer_secret'],
        ];
    }

    private function resolve_currency(array $settings): string
    {
        if ($settings['currency'] !== '') {
            return $settings['currency'];
        }
        if (function_exists('get_woocommerce_currency')) {
            return (string) get_woocommerce_currency();
        }
        return 'USD';
    }
}
