import os
import argparse
import asyncio
import joblib
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import torch
import torch.nn as nn
from torch.utils.data import DataLoader
from sklearn.metrics import roc_curve, auc, precision_recall_fscore_support, confusion_matrix
from backend.ml.data_pipeline import LSTMDataPipeline
from backend.ml.dataset import PhantomDataset
from backend.ml.model import PhantomLSTM

def parse_args():
    parser = argparse.ArgumentParser(description="Phantom Protocol LSTM Training")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=0.001)
    parser.add_argument("--hidden-size", type=int, default=64)
    parser.add_argument("--lambda-minutes", type=float, default=0.3)
    parser.add_argument("--env-ids", nargs="+", default=["nie-cs-lab-201", "nie-cs-classroom-104"])
    parser.add_argument("--output-dir", type=str, default="backend/ml/checkpoints")
    return parser.parse_args()

async def main_async():
    args = parse_args()
    print("Starting Phantom Protocol LSTM Training lifecycle...")
    
    # 1. Load dataset
    pipeline = LSTMDataPipeline()
    full_dataset = await pipeline.build_dataset(args.env_ids)
    
    # 2. Dataset inspection stats
    total_n = len(full_dataset)
    y_event_all = full_dataset.y_event.numpy()
    pos_count = int(np.sum(y_event_all == 1.0))
    neg_count = total_n - pos_count
    print(f"Dataset Size: {total_n} samples (Positive: {pos_count}, Negative: {neg_count})")
    
    # 3. Normalize dataset X
    X_raw = full_dataset.X.numpy()
    X_scaled, scaler = pipeline.normalize(X_raw)
    
    # Re-wrap in dataset
    normalized_dataset = PhantomDataset(X_scaled, full_dataset.y_event.numpy(), full_dataset.y_minutes.numpy())
    
    # 4. Temporal split
    train_ds, val_ds = pipeline.train_val_split(normalized_dataset, val_ratio=0.2)
    print(f"Split sizes: Train={len(train_ds)}, Validation={len(val_ds)}")
    
    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=False)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False)
    
    # Save scaler
    os.makedirs(args.output_dir, exist_ok=True)
    scaler_path = os.path.join(args.output_dir, "scaler.pkl")
    joblib.dump(scaler, scaler_path)
    print(f"MinMax Scaler saved to {scaler_path}")
    
    # Initialize Model, Optimizer, Loss functions
    model = PhantomLSTM(hidden_size=args.hidden_size)
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr, weight_decay=1e-4)
    bce_loss_fn = nn.BCELoss()
    mse_loss_fn = nn.MSELoss()
    
    best_val_loss = float('inf')
    epochs_no_improve = 0
    patience = 20
    
    train_losses = []
    val_losses = []
    
    # 5. Training Loop
    for epoch in range(1, args.epochs + 1):
        model.train()
        epoch_train_loss = 0.0
        
        for batch_X, batch_y_ev, batch_y_min in train_loader:
            optimizer.zero_grad()
            
            p_pred, min_pred = model(batch_X)
            
            # Loss calculations
            loss_ev = bce_loss_fn(p_pred, batch_y_ev)
            
            # Mask MSE loss (only for positive instances)
            pos_mask = (batch_y_ev == 1.0)
            if torch.sum(pos_mask) > 0:
                loss_min = mse_loss_fn(min_pred[pos_mask], batch_y_min[pos_mask] / 30.0)
            else:
                loss_min = torch.tensor(0.0, device=batch_X.device)
                
            loss = loss_ev + args.lambda_minutes * loss_min
            loss.backward()
            
            # Gradient clipping
            nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()
            
            epoch_train_loss += loss.item() * len(batch_X)
            
        epoch_train_loss /= len(train_ds)
        train_losses.append(epoch_train_loss)
        
        # Validation epoch evaluation
        model.eval()
        epoch_val_loss = 0.0
        with torch.no_grad():
            for batch_X, batch_y_ev, batch_y_min in val_loader:
                p_pred, min_pred = model(batch_X)
                
                loss_ev = bce_loss_fn(p_pred, batch_y_ev)
                pos_mask = (batch_y_ev == 1.0)
                if torch.sum(pos_mask) > 0:
                    loss_min = mse_loss_fn(min_pred[pos_mask], batch_y_min[pos_mask] / 30.0)
                else:
                    loss_min = torch.tensor(0.0)
                    
                loss = loss_ev + args.lambda_minutes * loss_min
                epoch_val_loss += loss.item() * len(batch_X)
                
        epoch_val_loss /= len(val_ds)
        val_losses.append(epoch_val_loss)
        
        if epoch % 5 == 0 or epoch == 1:
            print(f"Epoch {epoch}/{args.epochs} - Train Loss: {epoch_train_loss:.4f} | Val Loss: {epoch_val_loss:.4f}")
            
        # Early Stopping check
        if epoch_val_loss < best_val_loss:
            best_val_loss = epoch_val_loss
            epochs_no_improve = 0
            model.save(os.path.join(args.output_dir, "best_model.pt"))
        else:
            epochs_no_improve += 1
            if epochs_no_improve >= patience:
                print(f"Early stopping triggered at epoch {epoch}.")
                break
                
    # 6. Load best model and generate final verification plots
    best_model_path = os.path.join(args.output_dir, "best_model.pt")
    model = PhantomLSTM.load(best_model_path)
    model.eval()
    
    # Gather val predictions
    all_p_pred = []
    all_min_pred = []
    all_y_ev = []
    all_y_min = []
    
    with torch.no_grad():
        for batch_X, batch_y_ev, batch_y_min in val_loader:
            p, m = model(batch_X)
            all_p_pred.extend(p.tolist())
            all_min_pred.extend((m * 30.0).tolist())
            all_y_ev.extend(batch_y_ev.tolist())
            all_y_min.extend(batch_y_min.tolist())
            
    all_p_pred = np.array(all_p_pred)
    all_min_pred = np.array(all_min_pred)
    all_y_ev = np.array(all_y_ev)
    all_y_min = np.array(all_y_min)
    
    # Save Figures
    os.makedirs("docs/figures", exist_ok=True)
    
    # Loss curves
    plt.figure()
    plt.plot(train_losses, label="Train Loss", color="#8b5cf6")
    plt.plot(val_losses, label="Val Loss", color="#ef4444")
    plt.title("LSTM Training & Validation Loss")
    plt.xlabel("Epochs")
    plt.ylabel("Loss")
    plt.legend()
    plt.grid(True, linestyle='--', alpha=0.5)
    plt.savefig("docs/figures/train_val_loss.png", dpi=150)
    plt.close()
    
    # ROC Curve
    fpr, tpr, _ = roc_curve(all_y_ev, all_p_pred)
    roc_auc = auc(fpr, tpr)
    plt.figure()
    plt.plot(fpr, tpr, color='#10b981', lw=2, label=f'ROC Curve (AUC = {roc_auc:.3f})')
    plt.plot([0, 1], [0, 1], color='#64748b', linestyle='--')
    plt.xlim([0.0, 1.0])
    plt.ylim([0.0, 1.05])
    plt.title("ROC Curve on Validation Set")
    plt.xlabel("False Positive Rate")
    plt.ylabel("True Positive Rate")
    plt.legend(loc="lower right")
    plt.grid(True, linestyle='--', alpha=0.5)
    plt.savefig("docs/figures/roc_curve.png", dpi=150)
    plt.close()
    
    # Confusion Matrix (Threshold 0.5)
    preds_binary = (all_p_pred >= 0.5).astype(int)
    cm = confusion_matrix(all_y_ev, preds_binary)
    plt.figure()
    plt.imshow(cm, interpolation='nearest', cmap=plt.cm.Purples)
    plt.title("Confusion Matrix (Threshold = 0.5)")
    plt.colorbar()
    tick_marks = np.arange(2)
    plt.xticks(tick_marks, ["Nominal", "Anomaly"], rotation=45)
    plt.yticks(tick_marks, ["Nominal", "Anomaly"])
    
    # Print values inside confusion matrix
    for i in range(2):
        for j in range(2):
            plt.text(j, i, str(cm[i, j]), horizontalalignment="center", color="white" if cm[i, j] > (cm.max() / 2) else "black")
            
    plt.tight_layout()
    plt.ylabel('True label')
    plt.xlabel('Predicted label')
    plt.savefig("docs/figures/confusion_matrix.png", dpi=150)
    plt.close()
    
    # Lead time scatter
    pos_mask = (all_y_ev == 1.0)
    plt.figure()
    if np.sum(pos_mask) > 0:
        plt.scatter(all_y_min[pos_mask], all_min_pred[pos_mask], color="#fbbf24", alpha=0.6, edgecolors='black')
        # Draw identity line
        lims = [0, max(all_y_min[pos_mask].max(), all_min_pred[pos_mask].max())]
        plt.plot(lims, lims, '--', color='#64748b', alpha=0.7)
    plt.title("Lead Time Prediction Error")
    plt.xlabel("Actual Minutes to Event")
    plt.ylabel("Predicted Minutes to Event")
    plt.grid(True, linestyle='--', alpha=0.5)
    plt.savefig("docs/figures/lead_time_error.png", dpi=150)
    plt.close()
    
    # Calculate precision, recall, F1
    precision, recall, f1, _ = precision_recall_fscore_support(all_y_ev, preds_binary, average='binary', zero_division=0)
    
    # Calculate False Positive Rate
    # FPR = FP / (FP + TN)
    tn, fp, fn, tp = cm.ravel()
    fpr_rate = fp / (fp + tn) if (fp + tn) > 0 else 0.0
    
    # Calculate MAE on lead time for positive samples
    if np.sum(pos_mask) > 0:
        mae_lead = np.mean(np.abs(all_y_min[pos_mask] - all_min_pred[pos_mask]))
    else:
        mae_lead = 0.0
        
    print("\n================ FINAL MODEL VALIDATION METRICS ================")
    print(f"Validation F1 Score:  {f1:.4f} (Target: > 0.75)")
    print(f"Validation AUC-ROC:   {roc_auc:.4f} (Target: > 0.85)")
    print(f"Validation Precision: {precision:.4f}")
    print(f"Validation Recall:    {recall:.4f}")
    print(f"False Positive Rate:  {fpr_rate:.4f} (Target: < 0.05)")
    print(f"Lead Time MAE:        {mae_lead:.2f} minutes (Target: < 5.0 min)")
    print("================================================================\n")

if __name__ == "__main__":
    asyncio.run(main_async())
