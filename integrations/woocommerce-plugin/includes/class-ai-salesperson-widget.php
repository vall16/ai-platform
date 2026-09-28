<?php

if (!defined('ABSPATH')) {
    exit;
}

class AI_Salesperson_Widget extends WP_Widget
{
    public function __construct()
    {
        parent::__construct(
            'ai_salesperson_widget',
            __('AI Salesperson', 'ai-salesperson'),
            ['description'] => __('AI shopping assistant widget', 'ai-salesperson')
        );
    }

    public function widget(array $args, array $instance): void
    {
        echo $args['before_widget'];
        echo do_shortcode('[ai_salesperson]');
        echo $args['after_widget'];
    }

    public function form(array $instance): void
    {
        // No additional widget-specific settings; uses global plugin settings.
        ?>
        <p><?php esc_html_e('Configure the AI Salesperson in Settings → AI Salesperson.', 'ai-salesperson'); ?></p>
        <?php
    }

    public function update(array $new_instance, array $old_instance): array
    {
        return $old_instance;
    }
}
