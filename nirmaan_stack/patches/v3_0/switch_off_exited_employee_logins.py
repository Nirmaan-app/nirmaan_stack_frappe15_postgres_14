"""Switch off the logins of people who left before an exit did so (ADR-0043).

Every User with no Nirmaan Users record (Administrator and Guest aside) whose login is still on is disabled and
stripped of its roles, role profile, API key and sessions (`services/exited_employees.switch_off_login`). No User
is deleted. Prints whom it changed; a second run changes nothing.
"""

from nirmaan_stack.services.exited_employees import switch_off_logins_still_on


def execute():
    changed = switch_off_logins_still_on()
    print(f"switch_off_exited_employee_logins: switched off {len(changed)} login(s)")
    for name in changed:
        print(f"    {name}")
