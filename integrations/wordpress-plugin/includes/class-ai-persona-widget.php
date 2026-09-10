<?php

if (!defined('ABSPATH')) {
    exit;
}

class AI_Persona_Widget extends WP_Widget
{
    public function __construct()
    {
        parent::__construct(
            'ai_persona_widget',
            __('AI Persona', 'ai-persona'),
            ['description'] => __('Conversational AI avatar widget', 'ai-persona')
        );
    }

    public function widget(array $args, array $instance): void
    {
        echo $args['before_widget'];
        echo do_shortcode('[ai_persona]');
        echo $args['after_widget'];
    }

    public function form(array $instance): void
    {
        // No additional widget-specific settings; uses global plugin settings.
        ?>
        <p><?php esc_html_e('Configure the AI Persona in Settings → AI Persona.', 'ai-persona'); ?></p>
        <?php
    }

    public function update(array $new_instance, array $old_instance): array
    {
        return $old_instance;
    }
}
