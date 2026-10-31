@FR-21
Feature: Clear All on the board
  As the owner,
  I want one button that dismisses every New job of a view,
  so that I can start afresh once I've looked through them.

  Background:
    Given the board has these jobs:
      | title       | view          | status |
      | Senior Dispatcher | LinkedIn      | New    |
      | Lead Nurse     | LinkedIn      | New    |
      | Saved Dispatcher  | LinkedIn      | Saved  |
      | Feed Dispatcher   | Other sources | New    |

  Scenario: Clear All says how many jobs it dismissed
    When I press Clear All on the LinkedIn view
    Then the board says "Dismissed 2 new LinkedIn jobs. Each one can be restored from Dismissed."
    And the New tab of the LinkedIn view is empty
    And the Saved tab of the LinkedIn view lists "Saved Dispatcher"
    And the New tab of the Other sources view lists "Feed Dispatcher"

  Scenario: Clear All with nothing in New says so
    Given I pressed Clear All on the LinkedIn view
    When I press Clear All on the LinkedIn view
    Then the board says "There were no new jobs to dismiss."
