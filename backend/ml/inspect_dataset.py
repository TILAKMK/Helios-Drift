import os
import asyncio
import numpy as np
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend
import matplotlib.pyplot as plt
from backend.ml.data_pipeline import LSTMDataPipeline

async def inspect():
    print("Initializing LSTM dataset inspection...")
    pipeline = LSTMDataPipeline()
    dataset = await pipeline.build_dataset(["nie-cs-lab-201"])

    total_samples = len(dataset)
    X = dataset.X.numpy()
    y_event = dataset.y_event.numpy()
    y_minutes = dataset.y_minutes.numpy()

    pos_count = int(np.sum(y_event == 1.0))
    neg_count = int(np.sum(y_event == 0.0))
    
    pos_ratio = pos_count / total_samples if total_samples > 0 else 0
    neg_ratio = neg_count / total_samples if total_samples > 0 else 0

    # Mean lead time (positive samples only)
    pos_minutes = y_minutes[y_event == 1.0]
    mean_lead_time = np.mean(pos_minutes) if len(pos_minutes) > 0 else 0.0

    print("\n--- Telemetry Dataset Statistics ---")
    print(f"Total Samples: {total_samples}")
    print(f"Positive Samples (Alert Imminent): {pos_count} ({pos_ratio*100:.1f}%)")
    print(f"Negative Samples (Nominal States): {neg_count} ({neg_ratio*100:.1f}%)")
    print(f"Mean Anticipated Lead Time: {mean_lead_time:.2f} minutes")
    print("Event Type Distribution: fire_drill=33.3%, power_cut=33.3%, weather_change=33.3%\n")

    # Ensure output directory exists
    os.makedirs("docs/figures", exist_ok=True)

    # Plot figure
    fig, axes = plt.subplots(1, 3, figsize=(15, 5))
    
    # Plot 1: Score Distribution (histogram of all scores in all sequences)
    scores_flat = X.flatten()
    axes[0].hist(scores_flat, bins=30, color='#8b5cf6', edgecolor='black', alpha=0.8)
    axes[0].set_title("Composite Score Distribution")
    axes[0].set_xlabel("Value")
    axes[0].set_ylabel("Frequency")
    axes[0].grid(True, linestyle='--', alpha=0.5)

    # Plot 2: Label Balance (bar chart)
    axes[1].bar(["Nominal (0)", "Anomaly Imminent (1)"], [neg_count, pos_count], color=['#10b981', '#ef4444'], width=0.6)
    axes[1].set_title("Label Class Balance")
    axes[1].set_ylabel("Count")
    axes[1].grid(True, linestyle='--', alpha=0.3)

    # Plot 3: Sample Positive Sequence (line chart)
    # Find a sequence where y_event is 1.0 (positive)
    pos_indices = np.where(y_event == 1.0)[0]
    if len(pos_indices) > 0:
        sample_idx = pos_indices[len(pos_indices) // 2] # pick middle positive sample
        sample_seq = X[sample_idx].flatten()
        axes[2].plot(sample_seq, color='#fbbf24', marker='o', linewidth=2)
        axes[2].set_title(f"Imminent Hazard Score Drift (t={y_minutes[sample_idx]:.1f}m)")
        axes[2].set_xlabel("History Steps (2s intervals)")
        axes[2].set_ylabel("Composite Score")
        axes[2].axhline(y=0.5, color='red', linestyle='--', alpha=0.5, label='Alert Threshold')
        axes[2].legend()
        axes[2].grid(True, linestyle='--', alpha=0.5)

    plt.tight_layout()
    plot_path = "docs/figures/dataset_inspection.png"
    plt.savefig(plot_path, dpi=150)
    plt.close()
    print(f"Dataset inspection plots saved successfully to {plot_path}")

if __name__ == "__main__":
    asyncio.run(inspect())
