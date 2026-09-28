<?php
/**
 * Plugin Name:       AI Salesperson
 * Description:       AI shopping assistant widget for your WooCommerce store. Text + voice, live product search & checkout.
 * Version:           0.1.0
 * Requires at least: 6.0
 * Requires PHP:      8.0
 * Author:            AI Platform
 * License:           GPL-2.0-or-later
 * Text Domain:       ai-salesperson
 */

if (!defined('ABSPATH')) {
    exit;
}

define('AI_SALESPERSON_VERSION', '0.1.0');
define('AI_SALESPERSON_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('AI_SALESPERSON_PLUGIN_URL', plugin_dir_url(__FILE__));

require_once AI_SALESPERSON_PLUGIN_DIR . 'includes/class-ai-salesperson.php';
require_once AI_SALESPERSON_PLUGIN_DIR . 'includes/class-ai-salesperson-settings.php';
require_once AI_SALESPERSON_PLUGIN_DIR . 'includes/class-ai-salesperson-widget.php';

register_activation_hook(__FILE__, ['AI_Salesperson', 'activate']);

add_action('plugins_loaded', function () {
    AI_Salesperson::instance();
});
