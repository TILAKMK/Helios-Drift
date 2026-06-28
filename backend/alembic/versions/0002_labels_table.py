"""labels table

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-28 09:30:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.create_table(
        'ground_truth_labels',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('env_id', sa.String(), nullable=False),
        sa.Column('device_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('session_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('event_type', sa.String(), nullable=False),
        sa.Column('severity', sa.Integer(), nullable=False),
        sa.Column('notes', sa.String(), nullable=True),
        sa.Column('labeled_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('score_at_time', sa.Float(), nullable=True),
        sa.Column('lead_time_actual_min', sa.Float(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.CheckConstraint('severity >= 1 AND severity <= 5', name='chk_severity_range')
    )

def downgrade() -> None:
    op.drop_table('ground_truth_labels')
