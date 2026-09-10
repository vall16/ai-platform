<?php
/**
 * Plugin Name:       AI Persona
 * Description:       Conversational AI avatar widget for your WordPress site. Text + voice.
 * Version:           0.1.0
 * Requires at least: 6.0
 * Requires PHP:      8.0
 * Author:            AI Platform
 * License:           GPL-2.0-or-later
 * Text Domain:       ai-persona
 */

if (!defined('ABSPATH')) {
    exit;
}

define('AI_PERSONA_VERSION', '0.1.0');
define('AI_PERSONA_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('AI_PERSONA_PLUGIN_URL', plugin_dir_url(__FILE__));

require_once AI_PERSONA_PLUGIN_DIR . 'includes/class-ai-persona.php';
require_once AI_PERSONA_PLUGIN_DIR . 'includes/class-ai-persona-settings.php';
require_once AI_PERSONA_PLUGIN_DIR . 'includes/class-ai-persona-widget.php';

register_activation_hook(__FILE__, ['AI_Persona', 'activate']);

add_action('plugins_loaded', function () {
    AI_Persona::instance();
});
