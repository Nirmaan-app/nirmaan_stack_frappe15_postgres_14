from . import __version__ as app_version

app_name = "nirmaan_stack"
app_title = "Nirmaan Stack"
app_publisher = "Nirmaan (Stratos Infra Technologies Pvt. Ltd.)"
app_description = "A fully fledged commercial construction project management stack."
app_email = "techadmin@nirmaan.app"
app_license = "mit"
# required_apps = []

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/nirmaan_stack/css/nirmaan_stack.css"
# app_include_js = "/assets/nirmaan_stack/js/nirmaan_stack.js"

# include js, css files in header of web template
# web_include_css = "/assets/nirmaan_stack/css/nirmaan_stack.css"
# web_include_js = "/assets/nirmaan_stack/js/nirmaan_stack.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "nirmaan_stack/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
# doctype_js = {"doctype" : "public/js/doctype.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "nirmaan_stack/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "nirmaan_stack.utils.jinja_methods",
# 	"filters": "nirmaan_stack.utils.jinja_filters"
# }

# Installation
# ------------

#before_install = "nirmaan_stack.install.before_install"
#after_install = "nirmaan_stack.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "nirmaan_stack.uninstall.before_uninstall"
# after_uninstall = "nirmaan_stack.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "nirmaan_stack.utils.before_app_install"
# after_app_install = "nirmaan_stack.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "nirmaan_stack.utils.before_app_uninstall"
# after_app_uninstall = "nirmaan_stack.utils.after_app_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "nirmaan_stack.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# DocType Class
# ---------------
# Override standard doctype classes

# override_doctype_class = {
# 	"ToDo": "custom_app.overrides.CustomToDo"
# }

# Document Events
# ---------------
# Hook on document methods and events

doc_events = {
	"User": {
        "after_insert": "nirmaan_stack.nirmaan_stack.doctype.nirmaan_users.nirmaan_users.create_user_profile",
		"on_update": "nirmaan_stack.nirmaan_stack.doctype.nirmaan_users.nirmaan_users.on_user_update",
		# "on_trash": "nirmaan_stack.nirmaan_stack.doctype.nirmaan_users.nirmaan_users.delete_user_profile"
	},
    "Nirmaan Users": {
        "on_trash": [
            "nirmaan_stack.integrations.controllers.nirmaan_users.on_trash",
            "nirmaan_stack.integrations.controllers.delete_doc_versions.generate_versions",
        ],
    },
    "User Permission": {
        "after_insert": [
            "nirmaan_stack.integrations.controllers.user_permission.after_insert",
            "nirmaan_stack.integrations.controllers.user_permission.add_nirmaan_user_permissions"
        ],
        "on_trash": "nirmaan_stack.integrations.controllers.user_permission.on_trash"
    },
    "Projects": {
        "after_insert": [
            "nirmaan_stack.nirmaan_stack.doctype.project_work_milestones.project_work_milestones.generate_pwm",
            "nirmaan_stack.nirmaan_stack.doctype.projects.projects.generateUserPermissions"
        ],
        "on_update": "nirmaan_stack.nirmaan_stack.doctype.project_work_milestones.project_work_milestones.edit_pwm",
        "on_update": "nirmaan_stack.nirmaan_stack.doctype.projects.projects.on_update"  
    },
    "Vendors": {
        "after_insert": "nirmaan_stack.nirmaan_stack.doctype.vendor_category.vendor_category.generate_vendor_category",
        # IMPLEMENT ON_UPDATE
		"on_update": "nirmaan_stack.nirmaan_stack.doctype.vendor_category.vendor_category.update_vendor_category",
        "on_trash": "nirmaan_stack.nirmaan_stack.doctype.vendor_category.vendor_category.delete_vendor_category"
    },
    "Items": {
        "after_insert": "nirmaan_stack.integrations.controllers.items.after_insert" 
    },
    "Procurement Requests": {
        # "before_insert": "nirmaan_stack.integrations.controllers.procurement_requests.before_insert",
        "after_insert": "nirmaan_stack.integrations.controllers.procurement_requests.after_insert",
        "on_update": "nirmaan_stack.integrations.controllers.procurement_requests.on_update",
        "on_trash": [
            "nirmaan_stack.integrations.controllers.procurement_requests.on_trash",
            "nirmaan_stack.integrations.controllers.delete_doc_versions.generate_versions"
        ],
        "after_delete": "nirmaan_stack.integrations.controllers.procurement_requests.after_delete"
    },
    "Procurement Orders": {
        "after_insert": "nirmaan_stack.integrations.controllers.procurement_orders.after_insert",
        "on_update": "nirmaan_stack.integrations.controllers.procurement_orders.on_update",
        "on_trash": [
            "nirmaan_stack.integrations.controllers.procurement_orders.on_trash",
            "nirmaan_stack.integrations.controllers.delete_doc_versions.generate_versions",
        ]
    },
    "Sent Back Category": {
        "after_insert": "nirmaan_stack.integrations.controllers.sent_back_category.after_insert",
        "on_update": "nirmaan_stack.integrations.controllers.sent_back_category.on_update",
        "on_trash": [
            "nirmaan_stack.integrations.controllers.sent_back_category.on_trash",
            "nirmaan_stack.integrations.controllers.delete_doc_versions.generate_versions",
        ]
    },
    "Version": {
        "after_insert": [
            "nirmaan_stack.integrations.controllers.nirmaan_versions.generate_amend_version",
            "nirmaan_stack.integrations.controllers.nirmaan_versions.remove_amend_version",
            "nirmaan_stack.integrations.controllers.nirmaan_versions.generate_sr_amend_version"
            ]
    },
    "Service Requests": {
        "on_trash": [
            "nirmaan_stack.integrations.controllers.service_requests.on_trash",
            "nirmaan_stack.integrations.controllers.delete_doc_versions.generate_versions"
        ],
        "on_update": "nirmaan_stack.integrations.controllers.service_requests.on_update"
    },
    "Project Estimates" : {
        "on_trash": "nirmaan_stack.integrations.controllers.delete_doc_versions.generate_versions",
    },
    "Project Payments": {
        "after_insert": "nirmaan_stack.integrations.controllers.project_payments.after_insert",
        "on_update": "nirmaan_stack.integrations.controllers.project_payments.on_update",
        "on_trash": [
            "nirmaan_stack.integrations.controllers.project_payments.on_trash",
            "nirmaan_stack.integrations.controllers.delete_doc_versions.generate_versions",
        ]
    },
     "Project Invoices": {
        "on_trash": "nirmaan_stack.integrations.controllers.delete_doc_versions.generate_versions",
    },
    "Non Project Expenses": {
        "on_trash": "nirmaan_stack.integrations.controllers.delete_doc_versions.generate_versions",
    },
    "Project Inflows": {
        "on_trash": "nirmaan_stack.integrations.controllers.delete_doc_versions.generate_versions",
    }
}

# Scheduled Tasks
# ---------------

scheduler_events = {
	# "all": [
	# 	"nirmaan_stack.tasks.all",
	# ],
	"daily": [
		"nirmaan_stack.populate_target_rates.populate_target_rates_by_unit",
		"nirmaan_stack.tasks.payment_term_worker.update_payment_term_status",
        "nirmaan_stack.tasks.item_status_update.update_item_status"
    
	],
   
  
# 	"hourly": [
# 		"nirmaan_stack.tasks.hourly"
# 	],

# 	"weekly": [
# 		"nirmaan_stack.tasks.weekly"
# 	],
# 	"monthly": [
# 		"nirmaan_stack.tasks.monthly"
# 	],
    #  "cron": {
    #     "12 15 * * *": [
    #         "nirmaan_stack.tasks.item_status_update.update_item_status"
    #     ],
       
       
    #  }
}

# Testing
# -------

# before_tests = "nirmaan_stack.install.before_tests"

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "nirmaan_stack.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "nirmaan_stack.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["nirmaan_stack.utils.before_request"]
# after_request = ["nirmaan_stack.utils.after_request"]

# Job Events
# ----------
# before_job = ["nirmaan_stack.utils.before_job"]
# after_job = ["nirmaan_stack.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"nirmaan_stack.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

# Fixtures

fixtures = [
	# All Data
    "Work Packages",
    "Procurement Packages",
    "Category",
    "Scopes of Work",
    "Milestones",
    {"dt": "Role", "filters": [["role_name", "like", "Nirmaan %"]]},
    {"dt": "Role Profile", "filters": [["role_profile", "like", "Nirmaan %"]]},
    {"dt": "Items", "filters": [["category", "=", "Additional Charges"]]},
    "Workflow",
    "Workflow State",
    "Workflow Action Master",
    "Portal Menu Item",
    "Print Format",
    "Expense Type",
    # "Pincodes"
]


website_route_rules = [{'from_route': '/frontend/<path:app_path>', 'to_route': 'frontend'}]