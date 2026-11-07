# Source requirements (verbatim from the BRD .docx)

Source: Baby Connections SiTE SOURCE Business Requirements Package. Converted with pandoc; treat as the contract.

# Introduction and Purpose

The purpose of this document is to define the business requirements for
bringing the Baby Connections program lifecycle into SiTE SOURCE or a
similar solution. The goal is to provide a centralized platform for
managing partner relationships, program delivery agreements, facilitator
onboarding, training, kit ordering, program administration, reporting,
and evaluation. Unlike GRFS, SiTE SOURCE will not manage family
registration for Baby Connections programs. Instead, it will support the
operational relationship between Strong Start, Program Partners, Site
Coordinators, Facilitators, and the Baby Connections team while
directing families to the Program Partner's own registration systems.

# Guiding Principles

The solution should reduce manual administration, minimize duplicate
data entry, improve visibility into program delivery, provide accurate
reporting, support scalability, and create a consistent experience for
Program Partners and Facilitators. The design should align with existing
approaches used in SiTE SOURCE, ViP, and current Letter Sounds and Words
and Get Ready for School workflows where practical.

# 1. Program Partner Lifecycle Management

SiTE SOURCE should support the complete lifecycle of a Program Partner
relationship.\
\
Expression of Interest:\
• Prospective partners should submit an online Expression of Interest.\
• Notifications should be sent to the Director of Programs and Baby
Connections Program Coordinator.\
• A prospective partner profile should be created.\
• The system should track relationship stages including Expression of
Interest, Initial Contact, Discovery, PDSA Review, PDSA Issued/Signed,
Active Partner, and Inactive Partner.\
\
Partner Profiles:\
• Maintain organizational information.\
• Record key contacts.\
• Track communities served.\
• Store notes, communications, and agreements.\
• Maintain historical relationship information.\
\
Workflow Management:\
• Dashboard of all partner opportunities.\
• Follow-up reminders and task management.\
• Visibility into pipeline and partner status.

# 2. Program Delivery and Support Agreement (PDSA)

Following approval to proceed, SiTE SOURCE should support generation and
execution of Program Delivery and Support Agreements.\
\
Requirements:\
• Generate agreements from approved templates.\
• Merge organizational information into template fields.\
• Support version control.\
• Integrate with DocuSign.\
• Track agreement status.\
• Notify appropriate Strong Start staff/teams.\
\
Agreement Tracking:\
• Date issued.\
• Date executed.\
• Agreement term.\
• Expiry date.\
• Renewal status.\
• Associated contacts.\
\
Automation Opportunities:\
• Automatically change partner status to Active upon execution.\
• Store signed agreements in the partner profile.\
• Generate renewal reminders.\
• Notify program staff when agreements are nearing expiration.\
•API integration in system connects Program Partner to Strong Start's
website to update partner listing.

# 3. Site Coordinators and Facilitator Management

Each Program Partner may identify one or more facilitators and
potentially a Site Coordinator.\
\
Facilitator Features:\
• Create and maintain facilitator profiles.\
• Track multiple facilitators within a partner.\
• Store contact information.\
• Track active and inactive status.\
• View training history.\
• View program delivery history.\
\
Site Coordinator Features:\
• Manage facilitators.\
• Review partner activity.\
• Support kit ordering.\
• Coordinate program notifications.\
\
The system should support organizational structures where one Site
Coordinator oversees multiple facilitators.

# 4. Training Registration and Certification

Training should follow the model being implemented through ViP.\
\
Training Registration:\
• Facilitators receive invitations.\
• Register through a self-service process.\
• Submit required onboarding information.\
• Select training dates and/or take online modular training at their
convenience\
\
Training Administration:\
• Track registration.\
• Track attendance.\
• Track completion.\
• Record trainer, location, and date.\
\
Post-Training Automation:\
• Update certification status and send certificate to Facilitator,
consider social media features (e.g. automatic post on LinkedIn "I
completed..."\
• Enable access to Baby Connections resources.\
• Send welcome communications.\
• Provide next-step guidance.\
• Record training completion permanently.

# 5. Resource Access and Knowledge Centre

Following training completion, facilitators should gain access to
protected resources.\
\
Resources may include:\
• Promotional Resources.\
• Templates.\
• Evaluation Tools.\
• Supplemental Training Videos .\
• Frequently Asked Questions.\
• Program Updates.\
\
Access should be role-based and managed through permissions.

# 6. Program Setup and Notification

Facilitators should notify Strong Start of upcoming Baby Connections
offerings.\
\
Data Collection:\
• Program name.\
• Location.\
• Delivery format.\
• Start and end dates.\
• Session schedule.\
• Facilitators.\
• Registration link.\
• Community served.\
• Projected number of participants.\
\
Workflow:\
• Facilitator submits program.\
• Strong Start reviews submission.\
• Program becomes approved.\
• Program information becomes available for external publication where
applicable.\
• API integration in system connects data to Strong Start's website to
program information automatically.\
\
The system is intended to promote programs and support reporting, not
manage family registrations.

# 7. Kit Ordering and Fulfillment

The platform should support ordering and tracking of Baby Connections
materials.\
\
Order Types:\
• Participant Kits.\
• Facilitator Kits.\
• Facilitator Manuals.\
• Replacement Materials.\
\
Order Information:\
• Quantity.\
• Shipping address.\
• Requested delivery date.\
• Program association.\
• Status

• Ability to update shipping costs.\
\
Automation:\
• Recommend quantities based on projected participation.\
• Trigger facilitator materials automatically after training if approved
by business rules.\
• Notify staff of fulfillment requirements (e.g. packing slips).\
• Invoicing\
• API integration with financial system(s)

# 8. Program Delivery Tracking

The system should track all program deliveries.\
\
Required Information:\
• Program details.\
• Facilitator.\
• Program Partner.\
• Number of families.\
• Number of kits distributed.\
• Delivery model.\
• Completion status.\
• Associated costs.\
\
Program dashboards should provide visibility into current, upcoming, and
completed deliveries.

# 9. Program Completion Reporting

At the conclusion of a program, facilitators should submit a completion
report.\
\
Capture:\
• Families served.\
• Kits distributed.\
• Program dates.\
• Completion confirmation.\
• Facilitator reflections.\
• Success stories.\
• Challenges.\
• \# of completed feedback surveys\
\
This information will support quality assurance, continuous improvement,
partner support, and funder reporting.

# 10. Parent Feedback Management

Parent feedback is a critical component of Baby Connections evaluation.\
\
Potential Models:\
• Direct online survey completion.\
• Facilitator-assisted data entry.\
• Batch upload of survey data.\
\
Reporting:\
• Response rates.\
• Program-level results.\
• Partner-level results.\
• Outstanding survey tracking.\
• Dashboard visibility.

# 11. Reporting and Dashboards

The system should support both operational and strategic reporting.\
\
Operational Reporting:\
• Active partners.\
• Agreements.\
• Training completion.\
• Programs scheduled.\
• Programs delivered.\
• Kit orders.\
\
Strategic Reporting:\
• Communities served.\
• Facilitators trained.\
• Families reached.\
• Kits distributed.\
• Program growth.\
• Evaluation outcomes.\
\
Future Power BI integration should be considered.

# 12. Permissions and Security

Role-based permissions should be implemented.\
\
Roles:\
• Root User.\
• Support (based on current LSW access model for internal users).\
• Program Partner Administrator.\
• Site Coordinator.\
• Facilitator.\
\
Security design should ensure users only access information required to
perform their responsibilities.

# Future Opportunities and Roadmap

Potential future enhancements include:\
• Website integration for automatic publication.\
• Inventory system integration.\
• Shipping notifications.\
• Facilitator credentials and digital certificates.\
• Partner community portal.\
• Renewal workflows.\
• Advanced analytics.\
• Power BI dashboards.\
• Automated annual impact reporting.\
\
Conclusion:\
The Baby Connections implementation should follow a lifecycle approach
beginning with partner acquisition, continuing through agreement
execution, facilitator onboarding and training, program delivery, kit
fulfillment, evaluation, and long-term partner relationship management.
The objective is to establish a scalable solution capable of supporting
future growth while reducing administrative effort and improving program
visibility.
