/// <reference types="Cypress" />

// 1. -> Logs in,
// 2. -> create a pr,
// 3. -> approve a pr,
// 4. -> fill vendor quotes,
// 5. -> approve again,
// 6. -> check it's presence in Approved PO

const login_pr_end_email = Cypress.env('login_Email');
const login_pr_end_password = Cypress.env('login_Password');
// const project_name = Cypress.env('project_Name');
const project_name = Cypress.env('project_Name') || "Wakefit GT Road";

describe('Add a procurement request to approve it --- End-to-End test flow', () => {

    beforeEach(() => {
        // Using cy.session() to preserve login between different test blocks
        // cy.session('loginSession', () => {

            //Loging In
            cy.intercept('POST', '**/api/method/login').as('loginRequest');
            cy.visit('/login');

            cy.contains('Login', {timeout: 3000}).should('be.visible');
            cy.get('[data-cy="username-login-input-email"]').should('be.visible').type(login_pr_end_email);
            cy.get('[data-cy="username-login-input-password"]').should('be.visible').type(login_pr_end_password);
            cy.get('[data-cy="login-button"]').should('be.visible').click();

            cy.wait('@loginRequest', {timeout: 3000}).its('response.statusCode').should('eq', 200);
            cy.url().should('include', 'localhost:8080');
            cy.contains('Modules').should('be.visible');
        // });
    });


    let prNumber;

    it('Navigates to Procurement requests page and Creates a new and normal PR', () => {

        cy.get('[data-cy="procurement-requests-button"]').should('be.visible').click();
        cy.get('[data-cy="procurement-requests-search-bar"]').should('be.visible');
        cy.get('[data-cy="procurement-requests-data-table"]').should('exist').within(() => {
            cy.get('thead').should('exist');
            cy.get('tbody tr').should('have.length.at.least', 1);
            cy.contains('th', '#PR').should('be.visible');
            cy.contains('th', 'Created On').should('be.visible');
        });


        cy.contains('Add New PR').should('be.visible').click();
        // // opening the dropdoen
        // cy.get('.css-art2ul-ValueContainer2').click();
        // // cy.get('.css-1nmdiq5-menu').should('be.visible');
        // cy.get('.css-1nmdiq5-menu')
        // .find('[role="option"]')
        // .then( $options => {
        //     const randomIndex = Math.floor( Math.random() * $options.length);
        //     const selectedOption = $options[randomIndex].textContent;
        //     cy.log(`Randomly Selected Option: ${selectedOption}`);
        //     cy.wrap($options[randomIndex]).click();
        // });


        // cy.pause()
        // Updated Logic for Creating PR for Particular Project
        // Opening the dropdown
        // cy.get('.css-art2ul-ValueContainer2').click();
        cy.get('input').type(project_name).type('{enter}')

        // cy.pause()

        // // Wait for the menu container to be visible
        // cy.get('.css-1nmdiq5-menu')
        //     .should('be.visible')
        //     .as('projectDropdownMenu');

        // cy.get('@projectDropdownMenu')
        //     .find('[role="option"]')
        //     .should('have.length.gte', 1)
        //     .and('be.visible');

        // // Now that we know options are present, proceed to filter
        // cy.get('@projectDropdownMenu')
        //     .find('[role="option"]')
        //     .filter((index, el) => {
        //         const optionText = el.textContent.trim();
        //         cy.log(`Filtering option: "${optionText}" against project: "${project_name}"`); // Debug log
        //         return optionText === project_name;
        //     })
        //     .should('have.length', 1)
        //     .click();
        // cy.log(`Selected project with exact match: ${project_name}`);
        

        // creating the PR According to the Project Name
        cy.get('[data-cy="add-new-pr-normal-custom-button"]').should('be.visible').click();
        cy.get('[data-cy="add-new-pr-normal"]').should('exist').click();

        cy.get('.rounded-xl.bg-card', { timeout: 10000 }) 
        /**  .should('have.length.gt', 0) */ 
        .then(($cards) => {
            const randomIndex = Math.floor(Math.random() * $cards.length);
            const selectedCard = $cards[randomIndex].textContent;
            cy.log(`Selected Work Package -> ${selectedCard}`)               
            cy.wrap($cards[randomIndex]).click();
        });

        // Function to repeat process for adding two items in the PR
        function itemAdditon(iteration) {

            cy.log(`Starting Test Iteration ${iteration}`);

            // Opening Dropdown to Select required Item
            cy.get('.css-b62m3t-container .css-1xc3v61-indicatorContainer', { timeout: 10000 })
            .should('be.visible')
            .click();

            cy.get('.css-1nmdiq5-menu [role="option"]', { timeout: 10000 })
                .should('have.length.greaterThan', 0)
                    .then(($options) => {
                        const randomIndex = Math.floor(Math.random() * $options.length);
                        const randomItemText = $options[randomIndex].textContent?.trim();
                        cy.log(`Randomly Selected Item... : ${randomItemText}`);
                        cy.wrap($options[randomIndex]).click();
                    });
   
            // Open dropdown for Selecting Make
            cy.get('.css-b62m3t-container .css-1xc3v61-indicatorContainer', { timeout: 10000})
                    .should('be.visible')
                    .click();

            // Trying to find and select "Local Make" option ( with fallback to first option selection )
            cy.get('body')
                    .then(($body) => {
                        if ($body.find(':contains("Local Make")').length > 0) {
                            cy.contains('.css-1nmdiq5-menu [role="option"]', 'Local Make')
                            .should('be.visible')
                            .click();
                        } else {
                            // Fallback for selecting first option
                            cy.get('.css-1nmdiq5-menu [role="option"]')
                                .first()
                                .click();
                        }

                    });

            cy.get('#quantity-input')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled');
    
            // Generate random number between 1-9 and type it
            const randomQuantity = Math.floor(Math.random() * 16) + 33;
            cy.get('#quantity-input')
                    .should('be.visible')
                    .clear()
                    .type(randomQuantity.toString())
                        .then(() => {
                            cy.log(`Entered Random Quantity: ${randomQuantity}`);
                        });
        
             // Array of possible PR item comments
             const itemComments = [
                "Please ensure this meets the project specifications before approval.",
                "Double-check the measurements against the technical drawings.",
                "This item requires additional safety certifications - please verify.",
                "Confirm lead time with vendor before proceeding with this item.",
                "Need clarification on the material grade for this component.",
                "This matches our quality standards - ready for procurement."
            ];
    
            // selecting and typing any random comment from the Array
            cy.get('#comment-input')
                .should('be.visible')
                .clear()
                .type(itemComments[Math.floor(Math.random() * itemAdditon.length)], {delay: 33})
                    .then(($input) => {
                        cy.log(`Entered Comment : "${$input.val()}"`);
                    });
            
            cy.contains('button', 'Add to Cart')
                .scrollIntoView()
                .should('have.class', 'bg-background')
                .and('be.visible')
                .click();

        }

        // Execute 2-3 times
        [1, 2, /** 3 */].forEach((iteration) => {
            itemAdditon(iteration);
        });

        // Clicking Submit button after adding the Required Items ->
        cy.contains('button', /Submit Request/i)
            .scrollIntoView()
            .should('have.attr', 'aria-haspopup', 'dialog')
            .and('be.visible')
            .click();

        // 1. Targetting by placeholder + classes (most stable)
        cy.get('textarea[placeholder="Add final comments (optional)..."]')
            .should('be.visible')
            .type('This is my test comment for Normal PR Addition.');

        cy.contains('button', /^Cancel$/i)
            .should('have.class', 'bg-background')
            .and('have.attr', 'type', 'button')
            .and('be.visible')
            // .click();

        cy.get('button svg.lucide-check-check')
            .parent('button')
            .should('contain', 'Confirm')
            .and('be.visible')
            .click();

        
        cy.pause();

        // 1. Waiting for the toast container to exist in DOM
        cy.get('ol.fixed', { timeout: 15000})
            .should('exist')
                .then(() => {
                    // 2. Targeting the specific toast with green border (success toast)
                    cy.get('ol.fixed li.border-green-500', { timeout: 10000 })
                        .should('be.visible')
                            .then(($toast) => {
                                // 3. Debugging: Loging the entire toast content
                                cy.log('Toast Content: ', $toast.text());

                                // 4. Extracting text from the notification
                                const toastText = $toast.text().trim();

                                // 5. Trying multiple patterns to extract PR number
                                const patterns = [
                                    /PR[-_ ]?\d+-?(\d{3,})/,
                                    /#(\d+)/,
                                    /ID[: ]*(\d+)/i,
                                    /(\d{5,})/
                                ];

                                for ( const pattern of patterns ) {
                                    const match = toastText.match(pattern);
                                    if(match) {
                                        prNumber = (match[1] || match[0]).replace(/^0+/, '');
                                        break;
                                    }
                                }

                                if(!prNumber) {
                                    // 6. If no match, taking screenshot and failing with helpful message
                                    cy.screenshot('toast-notification-error');
                                    throw new Error(`Could not extract PR number from toast. Content: "${toastText}"`);
                                }

                                // 7. Storing the extracted PR number
                                cy.wrap(prNumber).as('prNumber');
                                cy.log(`Successfully extracted PR Number: ${prNumber}`);
                            });
                });

                // storing prNumber to access across all It Blocks
                Cypress.env('prNumber', prNumber);

                // 8. Usage logic for later use in test
                cy.get('@prNumber')
                    .then((prNumber) => {
                        cy.log(`Using extracted PR Number: ${prNumber}`);
                    });

    });


    it('Navigates to Procurement requests page And check for Newly Created PR and Approve IT', () => {

        // Navigating to Procurement Requests Page and Validates using Search-bar and Data-Table ------>
        cy.get('[data-cy="procurement-requests-button"]').should('be.visible').click();
        cy.get('[data-cy="procurement-requests-search-bar"]').should('be.visible');
        cy.get('[data-cy="procurement-requests-data-table"]').should('exist').within(() => {
            cy.get('thead').should('exist');
            cy.get('tbody tr').should('have.length.at.least', 1);
            cy.contains('th', '#PR').should('be.visible');
            cy.contains('th', 'Created On').should('be.visible');
            
        });
        
        // Base Url
        const baseUrl = Cypress.config('baseUrl');

        // PR Number
        Cypress.env('prNumber');

        // Ensuring the table is visible before proceeding
        cy.get('[data-cy="procurement-requests-data-table"]').should('exist');

        cy.get('[data-cy="procurement-requests-data-table"] tbody tr').should('have.length.at.least', 1);

        // Find the row that contains the PR number, then click its link
        // cy.get('[data-cy="procurement-requests-data-table"] tbody tr')
        //     .each(($row) => {
        //         cy.wrap($row)
        //             .within(() => {
        //                 cy.get('a[href^="/procurement-requests/PR-"]')
        //                     .then(($link) => {
        //                         const linkText = $link.text().trim();

        //                         if (linkText === prNumber){
        //                             const href = $link.attr('href');
        //                             const expectedUrl = `${baseUrl}${decodeURIComponent(href)}`;

        //                             cy.wrap($link).click();

        //                             // Verifying after navigation
        //                             cy.url()
        //                                 .then((currentUrl) => {
        //                                     const decodedCurrentUrl = decodeURIComponent(currentUrl);
        //                                     expect(decodedCurrentUrl).to.include(expectedUrl);
        //                                 });

        //                                 // Stopping Further Iterations
        //                                 return false;
        //                         }
        //                     });
        //             });
        //     });

        // Finding the link containing the PR number and click it
        cy.contains('[data-cy="procurement-requests-data-table"] a', prNumber)
            .should('be.visible')
                .then(($link) => {
                    const href = $link.attr('href');
                    const expectedUrl = `${baseUrl}${decodeURIComponent(href)}`;

                    cy.wrap($link).click();

                    // Verifying that the navigation succeeded
                    cy.url().then((currentUrl) => {
                        const decodedCurrentUrl = decodeURIComponent(currentUrl);
                        expect(decodedCurrentUrl).to.include(expectedUrl);
                    });
                });
        
        // Validating correct page navigation
        cy.contains('Approve/Reject/Delete PR', { timeout: 10000 }).should('be.visible');


        // Testing all PR Actions Buttons ------>
        // Test Delete PR Button
        // cy.contains('button', 'Delete PR')
        cy.get('[data-cy="delete-pr-button"]')
            .should('be.visible')
            .and('have.class', 'border-primary')
            .click();
            cy.contains('button', 'Confirm Delete')
                .should('exist')
                .and('be.visible')
                // .click()
            cy.contains('button', 'Cancel')
                .should('exist')
                .and('be.visible')
                .click();

        // Test Reject PR Button
        // cy.contains('button', 'Reject PR')
        cy.get('[data-cy="reject-pr-button"]')
            .should('be.visible')
            .and('have.class', 'border-primary')
            .click();
            cy.contains('button', 'Confirm Rejection')
                .should('exist')
                .and('be.visible')
                // .click()
            cy.contains('button', 'Cancel')
                .should('exist')
                .and('be.visible')
                .click();

        // Test Approve PR button
        // cy.contains('button', 'Approve PR')
        cy.get('[data-cy="approve-pr-button"]')
            .should('be.visible')
            .and('not.have.class', 'border-primary')
            .and('have.class', 'bg-primary')
            .click();
            cy.contains('button', 'Confirm Approval')
                .should('exist')
                .and('be.visible')
                // .click()
            cy.contains('button', 'Cancel')
                .should('exist')
                .and('be.visible')
                .click();
            // cy.contains('PR Approved')
            //     .should('exist')
            //     .and('be.visible')


        // Validate Add Missing Products button ------> 
        cy.contains('button', 'Add Missing Products')
        .should('be.visible')
        .and('have.class', 'bg-blue-600')
        .and('not.be.disabled');
        
        // Open the modal
        cy.contains('button', 'Add Missing Products').click();
        
        // Work with the modal
        cy.get('[role="alertdialog"]')
            .should('be.visible')
            .within(() => {
            // Verify modal structure
            cy.contains('h2', 'Add Missing Product').should('be.visible');
            cy.get('button').contains('X').should('be.visible');
            cy.contains('label', 'Select Product').should('be.visible');
        
            // 1. Focus and type in the search input
            // cy.get('#react-select-3-input')
            cy.get('.css-art2ul-ValueContainer2')
                .first()
                .click(/** { force: true } **/)
        
            // 2. Wait for options to appear and select first product
            cy.get('div', { timeout: 10000 })
                .should('have.length.gt', 0)
                .then(($products) => {
                    const productCount = $products.length;
                    const randomIndex = Math.floor(Math.random() * productCount);
                    const randomProduct = $products[randomIndex];
                    const randomProductText = $products[randomIndex].textContent;

                    cy.wrap(randomProduct).click({ force: true });
                    Cypress.env('selectedProduct', randomProductText);

                });

            // Check if the dropdown is disabled 
            cy.get('.react-select__control').then(($control) => {
                if($control.hasClass('react-select__control--is-disabled')){
                    cy.log('Dropdown is disabled - enable it first');
                }
            });

            // Interaction with the dropdown
            cy.get('#add-item-make-select').click({force: true});

            // Wait for options to appear and select the first one
            cy.get('.react-select__menu')
                .find('.react-select__option')
                .first()
                .click();


            const randomQty = Math.floor(Math.random() * 6) + 1;
            
            cy.get('input[type="number"]')
                .should('be.visible')
                .type(String(randomQty));
        
            // Verify dependent fields are now enabled
            cy.get('#add-item-make-select').should('not.be.disabled');
            cy.get('input[placeholder="Unit"]').should('not.be.disabled');
            cy.get('input[placeholder="Qty"]').should('not.be.disabled');

            // Test Create New Product link
            cy.contains('button', 'Create New Product')
                .should('be.visible')
                .and('have.class', 'text-blue-600');
                
            // Test Cancel button
            cy.contains('button', 'Cancel')
                .should('be.visible')
                // .click();

            // Test Cancel button
            cy.contains('button', 'Add Product')
                .should('be.visible')
                .click();

            });


            cy.contains('Item Added')
                // .should('exist')
                .and('be.visible');
            cy.log('Misssing Item Added Successfully......');
                
            cy.wait(1000); 
           
            // --- WAIT FOR MODAL TO CLOSE ---
            cy.get('[role="alertdialog"]').should('not.exist');
            cy.log('Add Missing Item Dialog Closed Properly');

                
            // Test PR Action buttons after adding missing product ------>
                // Test Delete PR button
                cy.get('[data-cy="delete-pr-button"]', { timeout: 19000 })
                    .should('be.visible')
                    .then(($button) => {
                        const isDisabled = $button.attr('disabled') ||
                                            $button.hasClass('disbled') ||
                                            $button.css('pointer-events') === 'none';

                        if(isDisabled) {
                            cy.log('Delete PR Button state:', {
                                disabledAttr: $button.attr('disabled'),
                                disabledClass: $button.hasClass('disabled'),
                                pointerEvents: $button.css('pointer-events'),
                                opacity: $button.css('opacity')
                            });
                        } else {
                            cy.wrap($button)
                                // .should('have.attr', 'disabled')
                                // .should('not.have.css', 'pointer-events', 'none')
                                .click();
                        }
                    });
                    cy.contains('button', 'Confirm Delete')
                        .should('exist')
                        .and('be.visible')
                        // .click()
                    cy.contains('button', 'Cancel')
                        .should('exist')
                        .and('be.visible')
                        .click();

            // Test Reject PR button
            cy.get('[data-cy="reject-pr-button"]', { timeout: 16000 })
                .should('be.visible')
                .then(($buttonRejectPR) => {
                    const isDisabled = $buttonRejectPR.attr('disabled') ||
                                        $buttonRejectPR.hasClass('disbled') ||
                                        $buttonRejectPR.css('pointer-events') === 'none';

                    if(isDisabled) {
                        cy.log('Reject PR Button state:', {
                            disabledAttr: $buttonRejectPR.attr('disabled'),
                            disabledClass: $buttonRejectPR.hasClass('disabled'),
                            pointerEvents: $buttonRejectPR.css('pointer-events'),
                            opacity: $buttonRejectPR.css('opacity')
                        });
                    // } else {   
                        cy.wrap($buttonRejectPR)
                            // .should('have.attr', 'disabled')
                            // .should('not.have.css', 'pointer-events', 'none')
                            .click({force: true});
                    }
                });
                cy.contains('Confirm Rejection')
                    .should('exist')
                    .and('be.visible')
                    // .click()
                cy.contains('button', 'Cancel')
                    .should('exist')
                    .and('be.visible')
                    .click();

            // Test Approve PR button
            cy.get('[data-cy="approve-pr-button"]', { timeout: 16000 })
                .should('be.visible')
                .then(($buttonApproveButton) => {
                    const isDisabled = $buttonApproveButton.attr('disabled') ||
                                    $buttonApproveButton.hasClass('disabled') ||
                                    $buttonApproveButton.css('pointer-events') === 'none';

                    if(isDisabled) {
                        cy.log('Approve PR Button state:', {
                            disabledAttr: $buttonApproveButton.attr('disabled'),
                            disabledClass: $buttonApproveButton.hasClass('disabled'),
                            pointerEvents: $buttonApproveButton.css('pointer-events'),
                            opacity: $buttonApproveButton.css('opacity')
                        });
                    // } else {
                        cy.wrap($buttonApproveButton)
                            // .should('not.have.attr', 'disabled')
                            // .should('not.have.css', 'pointer-events', 'none')
                            .click();
                    }
                });
                cy.contains('button', 'Cancel')
                    .should('exist')
                    .and('be.visible')
                    // .click();
                cy.contains('button', 'Confirm Approval')
                    .should('exist')
                    .and('be.visible')
                    .click()
                cy.contains('PR Approved')
                    .should('exist')
                    .and('be.visible')

            // Logging in the PR Number which is Approved
            cy.log(`Successfully Approved the PR with PR Number as: ${prNumber}`);
    });


    it('Navigates to Procurement Requests Page, Navigates to New PR Request tab and add Vendor Quotes', () => {

        // Navigating to Procurement Requests Page
        cy.get('[data-cy="procurement-requests-button"]')
            .should('be.visible').click();

        // Validating Right Page using Search Bar
        cy.get('[data-cy="procurement-requests-search-bar"]')
            .should('be.visible');

        // Navigating to New PR Requests page/container
        cy.get('[data-cy="new-pr-request-navigation"]')
            .should('exist')
            .and('be.visible')
            .click();
        
        // Validating Data-Table 
        cy.get('[data-cy="procurement-requests-data-table"]').should('exist').within(() => {
            cy.get('thead').should('exist');
            cy.get('tbody tr').should('have.length.at.least', 1);
            cy.contains('th', '#PR').should('be.visible');
            cy.contains('th', 'Created').should('be.visible');
        });

        // Base URL
        const baseUrl = Cypress.config('baseUrl');

        // Get the PR number from Cypress environment or define directly
        Cypress.env('prNumber');

        // Ensuring the table is loaded and has at least one row
        cy.get('[data-cy="procurement-requests-data-table"]').should('exist');
        cy.get('[data-cy="procurement-requests-data-table"] tbody tr').should('have.length.at.least', 1);

        // Finding the link containing the PR number and click it
        cy.contains('[data-cy="procurement-requests-data-table"] a', prNumber, { timeout: 19000 })
            .should('be.visible')
                .then(($link) => {
                    const href = $link.attr('href');
                    const expectedUrl = `${baseUrl}${decodeURIComponent(href)}`;

                    // Clicking the PR link
                    cy.wrap($link).click();

                    // Verifying that the navigation succeeded
                    cy.url()
                        .then((currentUrl) => {
                            const decodedCurrentUrl = decodeURIComponent(currentUrl);
                            expect(decodedCurrentUrl).to.include(expectedUrl);
                        });
                });

        // Validating correct page navigation
        cy.contains('Summary', { timeout: 10000 }).should('be.visible');

        // Validating the 'Delete PR' button using data-cy attribute
        cy.get('[data-cy="delete-pr-procurement-vendor"]')
            .should('exist')
            .and('be.visible')
            .click();

        // Check the Heading text of the Dialog
        cy.get('[data-cy="delete-pr-procurement-vendor-dialog-text"]')
        .should('exist')
        .and('be.visible')
        .and('have.text', 'Delete Procurement Request')
        
        // Check Confirm Approval button visibility in Dialog Box
        cy.get('[data-cy="delete-pr-procurement-vendor-dialog-confirm"]')
            .should('exist')
            .and('be.visible')
            // .click();

        
        // Check Cancel button visibility in Dialog Box
        cy.get('[data-cy="delete-pr-procurement-vendor-dialog-cancel"]')
            .should('exist')
            .and('be.visible')
            .click();

        // Validating Continue Button and Clicking to navigate to Next Page
        cy.get('[data-cy="procurement-vendor-continue-button"]')
            .should('exist')
            .and('be.visible')
            .should('not.be.disabled')
            .click();

        // Selecting Vendors
        cy.get('[data-cy="vendore-quote-vendor-selection-button"]')
            .should('exist')
            .and('be.visible')
            .should('not.be.disabled')
            .click();

        // Vendor Selection Dialog --->
        // Step 1: Check for the heading
        cy.contains('[data-cy="vendor-addition-text"]', 'Add Vendors to RFQ')
            .should('exist')
            .and('be.visible');
        
        // Pick two random characters from a-y
        const characters = 'abcdefghijklmnopqrstuvwxy'.split('');
        const randomChars = Cypress._.sampleSize(characters, 2);

        // Type into dropdown input and select first visible option
        randomChars.forEach( char => {
            cy.get('[data-cy="vendor-addition-dropdown')
                .click()
                // .clear()
                .type(char);

        // Waiting for dropdown menu and then selecting the first option
        cy.get('.css-1nmdiq5-menu')
            // .siblings()
            .find('div')
            .first()
            .click();
        });

        // // Confirming that two vendors are selected
        // cy.get('.css-art2ul-ValueContainer2 div')
        //     .should('have.length', 2);
        
        // Validating Vendor Selection Cancel Button
        cy.get('[data-cy="vendor-selection-cancel-button"]')
            .should('exist')
            .and('be.visible')
            // .click();

        // Validating Vendor Selection Confirm Button
        cy.get('[data-cy="vendor-selection-confirm-button"]')
            .should('exist')
            .and('be.visible')
            .click();


        // Filling Vendor Quotes --->
        // Get all item rows
        cy.get('tbody tr')
            .then(($rows) => {
                const itemCount = $rows.length;
                cy.log(`Found ${itemCount} items to Process`);
                // Process each row sequentially
                Cypress._.times(itemCount, (rowIndex) => {
                    cy.get('tbody tr').eq(rowIndex)
                        .then(($row) => {
                            // Get vendor card count for this row
                            const vendorCardCount = $row.find('[data-cy="vendor-quote-rate"]').length;
                            cy.log(`Processing item ${rowIndex + 1} with ${vendorCardCount} vendors`);

                            // Process each vendor card in this row
                            Cypress._.times(vendorCardCount, (vendorIndex) => {
                                cy.get('tbody tr').eq(rowIndex)
                                    .within(() => {
                                        cy.get('[role="radio"]').eq(vendorIndex)
                                            .within(() => {

                                                // 1. Select first Make option
                                                cy.get('.css-b62m3t-container')
                                                    .click();
                                                cy.get('.css-w9q2zk-Input2')
                                                    .first()
                                                    .click();
                                            
                                                // 2. Enter random rate between 63-330
                                                const randomRate = Math.floor(Math.random() * (330 - 63 + 1)) + 1000;
                                                cy.get('[data-cy="vendor-quote-rate"]')
                                                    .clear()
                                                    .type(randomRate.toString());
                                            });
                                    });
                            });
                        });
                });
            });

        // Additional validation check for rates
        cy.get('tbody tr').each(($row) => {
            cy.wrap($row).find('[data-cy="vendor-quote-rate"]')
                .each(($rateInput) => {
                    cy.wrap($rateInput).should('not.have.value', '');
                });
        });
        

        // Navigating to View Page
        // Verify Edit becomes active and View becomes inactive
        // cy.get('[data-cy="vendor-quotes-edit-button"]')
        cy.get('[data-cy="vendor-quotes-edit-button"]')
            .scrollIntoView()
            .should('exist')
            .and('be.visible');
            // .should('have.class', 'bg-red-100');

        cy.get('[data-cy="vendor-quotes-view-button"]')
            .scrollIntoView()
            .should('not.have.class', 'bg-red-100');

        // View Button
        cy.get('[data-cy="vendor-quotes-view-button"]')
            .should('exist')
            .and('be.visible')
            .click();

        // Selecting Minimum Rates Cards
        // cy.get('tbody tr').each(($row) => {
        //     cy.wrap($row).within(() => {
        //       const vendorCards = [];
              
        //       // Updated selector to match your actual DOM structure
        //       cy.get('[role="radio"]').each(($card) => {
        //         cy.wrap($card).within(() => {
        //           // More precise selector based on your HTML structure
        //           cy.get('div.flex.flex-col.gap-1:has(label:contains("Rate"))').within(() => {
        //             cy.get('p').invoke('text').then((rateText) => {
        //               const rate = parseFloat(rateText.replace(/[^0-9.]/g, ''));
        //               vendorCards.push({ element: $card, rate });
        //             });
        //           });
        //         });
        //       }).then(() => {
        //         if (vendorCards.length > 0) {
        //           const minRateCard = vendorCards.reduce((min, card) => 
        //             card.rate < min.rate ? card : min, vendorCards[0]);
                  
        //           cy.wrap(minRateCard.element).click();
                  
        //           // Verify selection - adjust this based on your actual selected state indicator
        //           cy.wrap(minRateCard.element)
        //             .find('.lucide-circle-check')
        //             .should('be.visible');
        //         }
        //       });
        //     });
        //   });

        // Updated Code for selecting Minimum Rates
        cy.get('tbody tr').each(($row) => {
            cy.wrap($row).within(() => {
              const vendorCards = [];
          
              cy.get('[role="radio"]').each(($card) => {
                cy.wrap($card).then(($el) => {
                  // Get the rate value by finding label: "Rate" and its sibling p
                  const labelEls = $el.find('label');
          
                  labelEls.each((_, label) => {
                    if (Cypress.$(label).text().trim() === 'Rate') {
                      const rateText = Cypress.$(label).next('p').text().trim();
                      const rate = parseFloat(rateText.replace(/[^0-9.]/g, ''));
                      vendorCards.push({ element: $card, rate });
                    }
                  });
                });
              }).then(() => {
                if (vendorCards.length > 0) {
                  const minRateCard = vendorCards.reduce((min, card) =>
                    card.rate < min.rate ? card : min, vendorCards[0]);
          
                  cy.wrap(minRateCard.element).click();
          
                  // Optionally verify selection if checkmark icon appears
                  cy.wrap(minRateCard.element)
                    .find('.lucide-circle-check')
                    .should('be.visible');
                }
              });
            });
          });

        
        // Revert and Continue Button
        cy.get('[data-cy="revert-pr-button"]')
          .should('exist')
          .and('be.visible')
          .click();

            // Revert PR Dialog - Box
            cy.get('[data-cy="revert-pr-dialog-text')
                .should('exist')
                .and('be.visible');
            
            // Revert PR cancel and confirm
            cy.get('[data-cy="revert-pr-dialog-confirm-button"]')
                .should('exist')
                .and('be.visible')
                // .click();

            cy.get('[data-cy="revert-pr-dialog-cancel-button"]')
                .should('exist')
                .and('be.visible')
                .click();

        // Validationg Continue Button
        cy.get('[data-cy="vendor-selection-continue-button"]')
          .should('exist')
          .and('be.visible')
          .should('not.be.disabled')
          .click();

        // Validation Vendor Selection Summary Send For Approval Button
        cy.get('[data-cy="vendor-selection-summary-send-for-approval-button"]')
          .should('exist')
          .and('be.visible')
          .should('contain.text', 'Send for Approval')
          .click();

            cy.get('[data-cy="send-for-approval-dialog-text"]')
                .should('exist')
                .and('be.visible');

                // Target the textarea using its class and placeholder
                cy.get('textarea[placeholder="type here..."].ant-input')
                    .should('be.visible')
                    .and('have.class', 'border-green-400')
                    .clear()
                    .type('This PR is sent for approval by Test - Automation flow...')
                    .should('have.value', 'This PR is sent for approval by Test - Automation flow...');

                // cy.get('[data-cy="send-for-approval-dialog-remarks-input"]')
                //     .should('exist')
                //     .and('be.visible')
                //     .clear()
                //     .type('This PR is sent for approval by Test - Automation flow');

                    cy.get('[data-cy="send-for-approval-dialog-cancel-button"]')
                        .should('exist')
                        .and('be.visible')
                        .should('contain.text', 'Cancel')
                        // .click();

                    cy.get('[data-cy="send-for-approval-dialog-confirm-button"]')
                        .should('exist')
                        .and('be.visible')
                        .should('contain.text', 'Confirm')
                        .click();
                    cy.contains('Success!')
                        .should('exist')
                        .and('be.visible');

        // Logging in the PR Number for which is Vendor Quotations are Added
        cy.log(`Successfully Added Vendor Quotations for the PR with PR Number as: ${prNumber}`);

    });


    it('Navigates to Purchase Orders and Approves the Procurement Request for which Vendor Quotations are added', () => {


        // Step 1: Validate the Purchase Orders button exists and is visible
        cy.get('[data-cy="purchase-orders-button"]')
        .should('be.visible')
        .and('contain.text', 'Purchase Orders')

        // Step 2: Click the button to go to the Purchase Orders page
        cy.get('[data-cy="purchase-orders-button"]')
            .click();

        // Step 3: Confirm navigation occurred
        cy.url().should('include', '/purchase-orders');
        cy.contains('PURCHASE-ORDERS')
            .should('exist')
            .and('be.visible');

        // Validating Approve PO Navigation Button is Active
        cy.get('[data-cy="approve-po-navigation"]')
            .should('be.visible')
            .closest('label')
            .should('have.class', 'ant-radio-button-wrapper-checked')
            .find('input[type="radio"]')
            .should('be.checked');

        // Search Bar Presence
        cy.get('[data-cy="procurement-requests-search-bar"]')
            .should('be.visible');

        // Data Table Presence
        cy.get('[data-cy="procurement-requests-data-table"]')
            .should('exist')
            .within(() => {
                cy.get('thead')
                    .should('exist');
                cy.get('tbody tr')
                    .should('have.length.at.least', 1);
                cy.contains('th', '#PR')
                    .should('be.visible');
                cy.contains('th', 'Created On')
                    .should('be.visible');
            });

        // Base URL
        const baseUrl = Cypress.config('baseUrl');

        // Get the PR number from Cypress environment or define directly
        Cypress.env('prNumber');

        // Ensuring the table is loaded and has at least one row
        cy.get('[data-cy="procurement-requests-data-table"]').should('exist');
        cy.get('[data-cy="procurement-requests-data-table"] tbody tr').should('have.length.at.least', 1);

        // Finding the link containing the PR Number and Clicking it
        cy.contains('[data-cy="procurement-requests-data-table"] a', prNumber, { timeout: 23000 })
            .should('be.visible')
                .then(($link) => {
                    const href = $link.attr('href');
                    const expectedUrl = `${baseUrl}${decodeURIComponent(href)}`;

                    // Clicking the PR Link
                    cy.wrap($link).click();

                    // Verifying that the navigation Succeeded
                    cy.url()
                        .then((currentUrl) => {
                            const decodedCurrentUrl = decodeURIComponent(currentUrl);
                            expect(decodedCurrentUrl).to.include(expectedUrl);
                        });
                });

         // Validating correct page navigation
         cy.contains(/^(Approve\/Reject Vendor Quotes|Approve\/Send Back Vendor Quotes)$/, { timeout: 10000 })
            .should('be.visible');

        // Click the Vendor Block
        cy.get('[data-cy="vendor-name-property"]')
            .should('exist')
            .and('be.visible')
            .first()
            .click( /** { force: true } */);

        // Wait for the items table to be visible
        cy.get('[data-cy="items-name-table"] table tbody tr')
            .should('have.length.greaterThan', 0);


         // Check all unchecked checkboxes inside the table
            // First get all vendor sections and expand them if closed
            cy.get('[data-cy="vendor-name-property"]').each(($vendor) => {
                // Check if the vendor section is closed
                cy.wrap($vendor).then(($el) => {
                const isClosed = $el.attr('data-state') === 'closed';
                
                if (isClosed) {
                    // Click the vendor header to expand it
                    cy.wrap($el).find('h3 > button').click();
                }
                
                // Wait for the content to be visible (adjust timeout if needed)
                cy.wrap($el).find('[data-cy="items-name-table"]').should('be.visible');
                
                // Now check all unchecked checkboxes in this vendor's table
                cy.wrap($el).find('[data-cy="items-name-table"] table tbody tr').each(($row) => {
                    cy.wrap($row).within(() => {
                    cy.get('button[role="checkbox"]').then(($checkbox) => {
                        const isChecked = $checkbox.attr('aria-checked') === 'true';
                        if (!isChecked) {
                        cy.wrap($checkbox).click();
                        }
                    });
                    });
                });
                });
            });
        

        // Validaying Reject Button
        cy.get('[data-cy="reject-button"]')
            .should('exist')
            .and('be.visible')
            .should('not.be.disabled')
            // .click();
    
        // Validating Approve Button
        cy.get('[data-cy="approve-button"]')
            .should('exist')
            .and('be.visible')
            .should('not.be.disabled')
            .click();

        // Check the Heading text of the Dialog
        cy.get('div[role="alertdialog"] h2')
            .should('exist')
            .and('be.visible')
            .and('have.text', 'Confirm Approval?')
        
        // Check Cancel button visibility in Dialog Box
        cy.contains('button', 'Cancel')
            .should('exist')
            .and('be.visible')
            // .click();
        
        // Check Confirm Approval button visibility in Dialog Box
        cy.contains('button', 'Confirm Approval')
            .should('exist')
            .and('be.visible')
            .click();
   
    });


    it('Navigates to Approved PO tab and check for the approved PR', () => {

        // Step 1: Validate the Purchase Orders button exists and is visible
        cy.get('[data-cy="purchase-orders-button"]')
        .should('be.visible')
        .and('contain.text', 'Purchase Orders')

        // Step 2: Click the button to go to the Purchase Orders page
        cy.get('[data-cy="purchase-orders-button"]')
            .click();

        // Step 3: Confirm navigation occurred
        cy.url().should('include', '/purchase-orders');
        cy.contains('PURCHASE-ORDERS')
            .should('exist')
            .and('be.visible');

        cy.get('[data-cy="approved-po-navigation"]')
            .should('exist')
            .and('be.visible')
            .click();

        // Data Table Presence
            cy.get('[data-cy="procurement-requests-data-table"]')
            .should('exist')
            .within(() => {
                cy.get('thead')
                    .should('exist');
                cy.get('tbody tr')
                    .should('have.length.at.least', 1);
                cy.contains('th', '#PO')
                    .should('be.visible');
                cy.contains('th', 'Created On')
                    .should('be.visible');
            });


        // ----------------------------------------------------------- //

        /** Unable to Match the Value with the PR number as PR number is not present in The Approved PO Table */

        // ----------------------------------------------------------- //
        
    });

});