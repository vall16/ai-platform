<?php

if (!defined('ABSPATH')) {
    exit;
}

class AI_Persona_Settings
{
    public function __construct()
    {
        add_action('admin_menu', [$this, 'add_menu']);
        add_action('admin_init', [$this, 'register_settings']);
    }

    public function add_menu(): void
    {
        add_menu_page(
            __('AI Persona', 'ai-persona'),
            __('AI Persona', 'ai-persona'),
            'manage_options',
            'ai-persona',
            [$this, 'render_page'],
            'dashicons-video-alt2',
            30
        );
    }

    public function register_settings(): void
    {
        register_setting('ai_persona_group', 'ai_persona_settings', [
            'type'              => 'array',
            'sanitize_callback' => [$this, 'sanitize'],
        ]);
    }

    public function sanitize(array $input): array
    {
        $output = [];
        $output['api_key']      = sanitize_text_field($input['api_key'] ?? '');
        $output['avatar_id']    = sanitize_text_field($input['avatar_id'] ?? '');
        $output['voice_id']     = sanitize_text_field($input['voice_id'] ?? '');
        $output['language']     = sanitize_text_field($input['language'] ?? 'en');
        $output['personality']  = sanitize_textarea_field($input['personality'] ?? '');
        $output['greeting']     = sanitize_text_field($input['greeting'] ?? '');
        $output['enable_voice'] = !empty($input['enable_voice']);
        $output['theme']        = in_array($input['theme'] ?? '', ['dark', 'light'], true)
            ? $input['theme']
            : 'dark';
        return $output;
    }

    public function render_page(): void
    {
        $settings = wp_parse_args(get_option('ai_persona_settings', []), [
            'api_key'      => '',
            'avatar_id'    => '',
            'voice_id'     => '',
            'language'     => 'en',
            'personality'  => '',
            'greeting'     => 'Hi! How can I help you today?',
            'enable_voice' => true,
            'theme'        => 'dark',
        ]);
        ?>
        <div class="wrap">
            <h1><?php esc_html_e('AI Persona Settings', 'ai-persona'); ?></h1>

            <form method="post" action="options.php">
                <?php settings_fields('ai_persona_group'); ?>

                <h2><?php esc_html_e('Connection', 'ai-persona'); ?></h2>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row">
                            <label for="ai-persona-api-key"><?php esc_html_e('API Key', 'ai-persona'); ?></label>
                        </th>
                        <td>
                            <input type="password" id="ai-persona-api-key" name="ai_persona_settings[api_key]"
                                   value="<?php echo esc_attr($settings['api_key']); ?>" class="regular-text" />
                            <p class="description"><?php esc_html_e('Your AI Platform API key. Get it from the Control Room dashboard.', 'ai-persona'); ?></p>
                        </td>
                    </tr>
                </table>

                <h2><?php esc_html_e('Avatar & Voice', 'ai-persona'); ?></h2>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row">
                            <label for="ai-persona-avatar-id"><?php esc_html_e('Avatar ID', 'ai-persona'); ?></label>
                        </th>
                        <td>
                            <input type="text" id="ai-persona-avatar-id" name="ai_persona_settings[avatar_id]"
                                   value="<?php echo esc_attr($settings['avatar_id']); ?>" class="regular-text" />
                            <p class="description"><?php esc_html_e('The avatar identity configured in your Control Room.', 'ai-persona'); ?></p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">
                            <label for="ai-persona-voice-id"><?php esc_html_e('Voice ID', 'ai-persona'); ?></label>
                        </th>
                        <td>
                            <input type="text" id="ai-persona-voice-id" name="ai_persona_settings[voice_id]"
                                   value="<?php echo esc_attr($settings['voice_id']); ?>" class="regular-text" />
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">
                            <label for="ai-persona-language"><?php esc_html_e('Language', 'ai-persona'); ?></label>
                        </th>
                        <td>
                            <select id="ai-persona-language" name="ai_persona_settings[language]">
                                <option value="en" <?php selected($settings['language'], 'en'); ?>>English</option>
                                <option value="it" <?php selected($settings['language'], 'it'); ?>>Italiano</option>
                            </select>
                        </td>
                    </tr>
                </table>

                <h2><?php esc_html_e('Behavior', 'ai-persona'); ?></h2>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row">
                            <label for="ai-persona-personality"><?php esc_html_e('Personality / System Prompt', 'ai-persona'); ?></label>
                        </th>
                        <td>
                            <textarea id="ai-persona-personality" name="ai_persona_settings[personality]"
                                      rows="5" class="large-text"><?php echo esc_textarea($settings['personality']); ?></textarea>
                            <p class="description"><?php esc_html_e('Defines how the AI persona behaves. E.g. "You are a friendly store assistant for a boutique clothing shop."', 'ai-persona'); ?></p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">
                            <label for="ai-persona-greeting"><?php esc_html_e('Greeting', 'ai-persona'); ?></label>
                        </th>
                        <td>
                            <input type="text" id="ai-persona-greeting" name="ai_persona_settings[greeting]"
                                   value="<?php echo esc_attr($settings['greeting']); ?>" class="regular-text" />
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><?php esc_html_e('Voice Input', 'ai-persona'); ?></th>
                        <td>
                            <label>
                                <input type="checkbox" name="ai_persona_settings[enable_voice]" value="1"
                                       <?php checked(!empty($settings['enable_voice'])); ?> />
                                <?php esc_html_e('Enable microphone input', 'ai-persona'); ?>
                            </label>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><?php esc_html_e('Theme', 'ai-persona'); ?></th>
                        <td>
                            <select name="ai_persona_settings[theme]">
                                <option value="dark" <?php selected($settings['theme'], 'dark'); ?>>Dark</option>
                                <option value="light" <?php selected($settings['theme'], 'light'); ?>>Light</option>
                            </select>
                        </td>
                    </tr>
                </table>

                <h2><?php esc_html_e('Embed', 'ai-persona'); ?></h2>
                <p><?php esc_html_e('Add the widget to any page or post using this shortcode:', 'ai-persona'); ?></p>
                <code>[ai_persona]</code>

                <?php submit_button(); ?>
            </form>
        </div>
        <?php
    }
}
