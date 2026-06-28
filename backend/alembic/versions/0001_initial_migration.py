"""initial migration

Revision ID: 0001
Revises: 
Create Date: 2026-06-27 18:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '0001'
down_revision = None
branch_labels = None
depends_on = None

def upgrade() -> None:
    # 1. Create sensor_readings
    op.create_table(
        'sensor_readings',
        sa.Column('time', sa.DateTime(timezone=True), nullable=False),
        sa.Column('device_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('env_id', sa.String(), nullable=False),
        sa.Column('session_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('mic_db', sa.Float(), nullable=True),
        sa.Column('accel_x', sa.Float(), nullable=True),
        sa.Column('accel_y', sa.Float(), nullable=True),
        sa.Column('accel_z', sa.Float(), nullable=True),
        sa.Column('accel_magnitude', sa.Float(), nullable=True),
        sa.Column('pressure_hpa', sa.Float(), nullable=True),
        sa.Column('wifi_rssi', sa.Float(), nullable=True),
        sa.Column('wifi_ap_count', sa.Integer(), nullable=True),
        sa.Column('ble_count', sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint('time', 'device_id')
    )
    
    # Create TimescaleDB hypertable for sensor_readings
    op.execute("SELECT create_hypertable('sensor_readings', 'time');")
    
    # 2. Create baselines
    op.create_table(
        'baselines',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('env_id', sa.String(), nullable=False),
        sa.Column('hour_of_day', sa.Integer(), nullable=False),
        sa.Column('computed_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('sample_count', sa.Integer(), nullable=False),
        sa.Column('mic_mean', sa.Float(), nullable=True),
        sa.Column('mic_std', sa.Float(), nullable=True),
        sa.Column('accel_mean', sa.Float(), nullable=True),
        sa.Column('accel_std', sa.Float(), nullable=True),
        sa.Column('pressure_mean', sa.Float(), nullable=True),
        sa.Column('pressure_std', sa.Float(), nullable=True),
        sa.Column('wifi_mean', sa.Float(), nullable=True),
        sa.Column('wifi_std', sa.Float(), nullable=True),
        sa.Column('ble_mean', sa.Float(), nullable=True),
        sa.Column('ble_std', sa.Float(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('env_id', 'hour_of_day', name='uq_env_hour')
    )
    
    # 3. Create drift_scores
    op.create_table(
        'drift_scores',
        sa.Column('time', sa.DateTime(timezone=True), nullable=False),
        sa.Column('env_id', sa.String(), nullable=False),
        sa.Column('device_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('mic_drift', sa.Float(), nullable=True),
        sa.Column('accel_drift', sa.Float(), nullable=True),
        sa.Column('pressure_drift', sa.Float(), nullable=True),
        sa.Column('wifi_drift', sa.Float(), nullable=True),
        sa.Column('ble_drift', sa.Float(), nullable=True),
        sa.Column('composite_score', sa.Float(), nullable=False),
        sa.Column('channels_above_threshold', sa.Integer(), nullable=True),
        sa.Column('cross_channel_event', sa.Boolean(), nullable=True),
        sa.PrimaryKeyConstraint('time', 'device_id')
    )
    
    # Create TimescaleDB hypertable for drift_scores
    op.execute("SELECT create_hypertable('drift_scores', 'time');")
    
    # 4. Create alert_events
    op.create_table(
        'alert_events',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('env_id', sa.String(), nullable=False),
        sa.Column('device_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('triggered_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('peak_score', sa.Float(), nullable=True),
        sa.Column('duration_seconds', sa.Integer(), nullable=True),
        sa.Column('channels_involved', sa.ARRAY(sa.String()), nullable=True),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('ground_truth', sa.Boolean(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )

def downgrade() -> None:
    op.drop_table('alert_events')
    op.drop_table('drift_scores')
    op.drop_table('baselines')
    op.drop_table('sensor_readings')
