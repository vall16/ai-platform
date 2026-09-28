<?php

if (!defined('ABSPATH')) {
    exit;
}

class AI_Salesperson_Settings
{
    public function __construct()
    {
        add_action('admin_menu', [$this, 'add_menu']);
        add_action('admin_init', [$this, 'register_settings']);
    }

    public function add_menu(): void
    {
        add_menu_page(
            __('AI Salesperson', 'ai-salesperson'),
            __('AI Salesperson', 'ai-salesperson'),
            'manage_options',
            'ai-salesperson',
            [$this, 'render_page'],
            'dashicons-cart',
            31
        );
    }

    public function register_settings(): void
    {
        register_setting('ai_salesperson_group', 'ai_salesperson_settings', [
            'type'              => 'array',
            'sanitize_callback' => [$this, 'sanitize'],
        ]);
    }

    public function sanitize(array $input): array
    {
        $output = [];
        $output['api_base']        = esc_url_raw($input['api_base'] ?? '');
        $output['api_key']         = sanitize_text_field($input['api_key'] ?? '');
        $output['shop_name']       = sanitize_text_field($input['shop_name'] ?? '');
        $output['currency']        = strtoupper(sanitize_text_field($input['currency'] ?? ''));
        $output['consumer_key']    = sanitize_text_field($input['consumer_key'] ?? '');
        $output['consumer_secret'] = sanitize_text_field($input['consumer_secret'] ?? '');
        $output['language']        = sanitize_text_field($input['language'] ?? 'en');
        $output['personality']     = sanitize_textarea_field($input['personality'] ?? '');
        $output['greeting']        = sanitize_text_field($input['greeting'] ?? '');
        $output['enable_voice']    = !empty($input['enable_voice']);
        $output['theme']           = in_array($input['theme'] ?? '', ['dark', 'light'], true)
            ? $input['theme']
            : 'light';
        return $output;
    }

    public function render_page(): void
    {
        $settings = wp_parse_args(get_option('ai_salesperson_settings', []), [
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
        ?>
        <div class="wrap">
            <h1><?php esc_html_e('AI Salesperson Settings', 'ai-salesperson'); ?></h1>

            <form method="post" action="options.php">
                <?php settings_fields('ai_salesperson_group'); ?>

                <h2><?php esc_html_e('Connection', 'ai-salesperson'); ?></h2>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row">
                            <label for="ai-salesperson-api-base"><?php esc_html_e('API Base URL', 'ai-salesperson'); ?></label>
                        </th>
                        <td>
                            <input type="url" id="ai-salesperson-api-base" name="ai_salesperson_settings[api_base]"
                                   value="<?php echo esc_attr($settings['api_base']); ?>" class="regular-text"
                                   placeholder="https://api.example.com" />
                            <p class="description"><?php esc_html_e('Base URL of your AI Platform backend (no trailing slash). E.g. https://api.example.com', 'ai-salesperson'); ?></p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">
                            <label for="ai-salesperson-api-key"><?php esc_html_e('API Key', 'ai-salesperson'); ?></label>
                        </th>
                        <td>
                            <input type="password" id="ai-salesperson-api-key" name="ai_salesperson_settings[api_key]"
                                   value="<?php echo esc_attr($settings['api_key']); ?>" class="regular-text" />
                            <p class="description"><?php esc_html_e('Your AI Platform API key. Get it from the Control Room dashboard.', 'ai-salesperson'); ?></p>
                        </td>
                    </tr>
                </table>

                <h2><?php esc_html_e('Store (WooCommerce)', 'ai-salesperson'); ?></h2>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row">
                            <label for="ai-salesperson-shop-name"><?php esc_html_e('Shop Name', 'ai-salesperson'); ?></label>
                        </th>
                        <td>
                            <input type="text" id="ai-salesperson-shop-name" name="ai_salesperson_settings[shop_name]"
                                   value="<?php echo esc_attr($settings['shop_name']); ?>" class="regular-text"
                                   placeholder="<?php echo esc_attr(get_bloginfo('name')); ?>" />
                            <p class="description"><?php esc_html_e('Shown in the widget header. Defaults to your site title if left empty.', 'ai-salesperson'); ?></p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">
                            <label for="ai-salesperson-currency"><?php esc_html_e('Currency', 'ai-salesperson'); ?></label>
                        </th>
                        <td>
                            <input type="text" id="ai-salesperson-currency" name="ai_salesperson_settings[currency]"
                                   value="<?php echo esc_attr($settings['currency']); ?>" class="small-text"
                                   placeholder="USD" />
                            <p class="description"><?php esc_html_e('ISO currency code. Defaults to your WooCommerce currency if left empty.', 'ai-salesperson'); ?></p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">
                            <label for="ai-salesperson-consumer-key"><?php esc_html_e('WooCommerce REST API — Consumer Key', 'ai-salesperson'); ?></label>
                        </th>
                        <td>
                            <input type="text" id="ai-salesperson-consumer-key" name="ai_salesperson_settings[consumer_key]"
                                   value="<?php echo esc_attr($settings['consumer_key']); ?>" class="regular-text"
                                   placeholder="ck_..." />
                            <p class="description"><?php esc_html_e('Create a key under WooCommerce → Settings → Advanced → REST API (Read permission). Leave both empty to run in demo mode with a sample catalog.', 'ai-salesperson'); ?></p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">
                            <label for="ai-salesperson-consumer-secret"><?php esc_html_e('WooCommerce REST API — Consumer Secret', 'ai-salesperson'); ?></label>
                        </th>
                        <td>
                            <input type="password" id="ai-salesperson-consumer-secret" name="ai_salesperson_settings[consumer_secret]"
                                   value="<?php echo esc_attr($settings['consumer_secret']); ?>" class="regular-text"
                                   placeholder="cs_..." />
                        </td>
                    </tr>
                </table>

                <h2><?php esc_html_e('Behavior', 'ai-salesperson'); ?></h2>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row">
                            <label for="ai-salesperson-language"><?php esc_html_e('Language', 'ai-salesperson'); ?></label>
                        </th>
                        <td>
                            <select id="ai-salesperson-language" name="ai_salesperson_settings[language]">
                                <option value="en" <?php selected($settings['language'], 'en'); ?>>English</option>
                                <option value="it" <?php selected($settings['language'], 'it'); ?>>Italiano</option>
                            </select>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">
                            <label for="ai-salesperson-personality"><?php esc_html_e('Personality / System Prompt', 'ai-salesperson'); ?></label>
                        </th>
                        <td>
                            <textarea id="ai-salesperson-personality" name="ai_salesperson_settings[personality]"
                                      rows="5" class="large-text"><?php echo esc_textarea($settings['personality']); ?></textarea>
                            <p class="description"><?php esc_html_e('Defines how the assistant behaves. E.g. "You are a helpful salesperson for a boutique clothing shop. Recommend products and guide the customer to checkout."', 'ai-salesperson'); ?></p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">
                            <label for="ai-salesperson-greeting"><?php esc_html_e('Greeting', 'ai-salesperson'); ?></label>
                        </th>
                        <td>
                            <input type="text" id="ai-salesperson-greeting" name="ai_salesperson_settings[greeting]"
                                   value="<?php echo esc_attr($settings['greeting']); ?>" class="regular-text" />
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><?php esc_html_e('Voice Input', 'ai-salesperson'); ?></th>
                        <td>
                            <label>
                                <input type="checkbox" name="ai_salesperson_settings[enable_voice]" value="1"
                                       <?php checked(!empty($settings['enable_voice'])); ?> />
                                <?php esc_html_e('Enable microphone input', 'ai-salesperson'); ?>
                            </label>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><?php esc_html_e('Theme', 'ai-salesperson'); ?></th>
                        <td>
                            <select name="ai_salesperson_settings[theme]">
                                <option value="light" <?php selected($settings['theme'], 'light'); ?>>Light</option>
                                <option value="dark" <?php selected($settings['theme'], 'dark'); ?>>Dark</option>
                            </select>
                        </td>
                    </tr>
                </table>

                <h2><?php esc_html_e('Embed', 'ai-salesperson'); ?></h2>
                <p><?php esc_html_e('Add the widget to any page or post using this shortcode:', 'ai-salesperson'); ?></p>
                <code>[ai_salesperson]</code>

                <?php submit_button(); ?>
            </form>
        </div>
        <?php
    }
}
